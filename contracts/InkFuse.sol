// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title InkFuse — an on-chain ink house for sketches
/// @notice An artist drops a sketch as an edition; collectors mint it for USDC that lands with the
///         artist instantly. Editions can be re-listed and resold on a built-in market, where the
///         contract splits the sale in a single transaction — a royalty to the artist, the rest to the
///         seller. Fans can also tip the artist directly. Built for ARC: every flow (primary sale,
///         secondary split, micro-tip) is a native-USDC payment, instant and multi-party, with no token.
contract InkFuse {
    struct Sketch {
        uint256 id;
        address artist;
        string uri;        // image url
        string title;
        uint256 price;     // primary price per edition (native USDC, 18 decimals)
        uint32 cap;        // max editions, 0 = open edition
        uint32 minted;     // editions minted so far
        uint16 royaltyBps; // resale royalty to the artist (<= MAX_ROYALTY_BPS)
        uint64 createdAt;
    }

    struct Edition {
        uint256 id;
        uint256 sketchId;
        uint32 number;     // edition number within the sketch
        address owner;
        uint256 listPrice; // resale ask, 0 = not listed
    }

    uint16 public constant MAX_ROYALTY_BPS = 2000; // 20%

    uint256 public sketchCount;
    uint256 public editionCount;

    mapping(uint256 => Sketch) public sketches;
    mapping(uint256 => Edition) public editions;
    mapping(address => uint256[]) private _byArtist;  // sketch ids by artist
    mapping(address => uint256[]) private _owned;      // current editions per owner (maintained as a set)
    mapping(uint256 => uint256) private _ownedIdx;     // 1-based index of an edition in its owner's _owned
    uint256[] private _listed;                         // active listings (maintained as a set)
    mapping(uint256 => uint256) private _listedIdx;    // 1-based index of an edition in _listed

    // economy stats (all native USDC)
    uint256 public primaryVolume;
    uint256 public secondaryVolume;
    uint256 public royaltiesPaid;
    uint256 public tipsPaid;
    mapping(address => uint256) public artistEarned; // lifetime: primary + royalties + tips

    event Dropped(uint256 indexed sketchId, address indexed artist, string uri, string title, uint256 price, uint32 cap, uint16 royaltyBps);
    event Collected(uint256 indexed sketchId, uint256 indexed editionId, address indexed collector, uint32 number, uint256 price);
    event Listed(uint256 indexed editionId, address indexed owner, uint256 price);
    event Delisted(uint256 indexed editionId, address indexed owner);
    event Sold(uint256 indexed editionId, address indexed from, address indexed to, uint256 price, uint256 royalty);
    event Tipped(uint256 indexed sketchId, address indexed from, address indexed artist, uint256 amount);

    /// @notice Drop a new sketch as an edition.
    function drop(string calldata uri, string calldata title, uint256 price, uint32 cap, uint16 royaltyBps) external returns (uint256) {
        require(bytes(uri).length > 0 && bytes(uri).length <= 400, "bad uri");
        require(bytes(title).length > 0 && bytes(title).length <= 120, "bad title");
        require(royaltyBps <= MAX_ROYALTY_BPS, "royalty too high");

        uint256 id = ++sketchCount;
        sketches[id] = Sketch(id, msg.sender, uri, title, price, cap, 0, royaltyBps, uint64(block.timestamp));
        _byArtist[msg.sender].push(id);
        emit Dropped(id, msg.sender, uri, title, price, cap, royaltyBps);
        return id;
    }

    /// @notice Mint the next edition of a sketch, paying the artist in USDC on the spot.
    function collect(uint256 sketchId) external payable returns (uint256) {
        Sketch storage s = sketches[sketchId];
        require(s.artist != address(0), "no sketch");
        require(s.cap == 0 || s.minted < s.cap, "sold out");
        require(msg.value >= s.price, "underpaid");

        // effects
        s.minted += 1;
        uint256 eid = ++editionCount;
        editions[eid] = Edition(eid, sketchId, s.minted, msg.sender, 0);
        _addOwned(msg.sender, eid);
        primaryVolume += msg.value;
        artistEarned[s.artist] += msg.value;

        // interaction
        if (msg.value > 0) {
            (bool ok, ) = payable(s.artist).call{value: msg.value}("");
            require(ok, "pay failed");
        }
        emit Collected(sketchId, eid, msg.sender, s.minted, msg.value);
        return eid;
    }

    /// @notice List an edition you own for resale.
    function list(uint256 editionId, uint256 price) external {
        Edition storage e = editions[editionId];
        require(e.owner == msg.sender, "not owner");
        require(price > 0, "price 0");
        e.listPrice = price;
        _addListed(editionId);
        emit Listed(editionId, msg.sender, price);
    }

    /// @notice Pull your edition off the market.
    function delist(uint256 editionId) external {
        Edition storage e = editions[editionId];
        require(e.owner == msg.sender, "not owner");
        require(e.listPrice > 0, "not listed");
        e.listPrice = 0;
        _removeListed(editionId);
        emit Delisted(editionId, msg.sender);
    }

    /// @notice Buy a listed edition. The contract splits the sale: royalty to the artist, rest to the seller.
    function buy(uint256 editionId) external payable {
        Edition storage e = editions[editionId];
        require(e.listPrice > 0, "not for sale");
        require(e.owner != msg.sender, "already yours");
        uint256 price = e.listPrice;
        require(msg.value >= price, "underpaid");

        Sketch storage s = sketches[e.sketchId];
        address seller = e.owner;
        uint256 royalty = (price * s.royaltyBps) / 10000;
        uint256 toSeller = msg.value - royalty; // any overpayment goes to the seller

        // effects
        e.owner = msg.sender;
        e.listPrice = 0;
        _removeListed(editionId);
        _removeOwned(seller, editionId);
        _addOwned(msg.sender, editionId);
        secondaryVolume += msg.value;
        royaltiesPaid += royalty;
        artistEarned[s.artist] += royalty;

        // interactions — both legs settle in this one transaction
        if (royalty > 0) {
            (bool r, ) = payable(s.artist).call{value: royalty}("");
            require(r, "royalty failed");
        }
        (bool ok, ) = payable(seller).call{value: toSeller}("");
        require(ok, "pay seller failed");

        emit Sold(editionId, seller, msg.sender, price, royalty);
    }

    /// @notice Tip an artist directly (patronage / micro-payment).
    function tip(uint256 sketchId) external payable {
        Sketch storage s = sketches[sketchId];
        require(s.artist != address(0), "no sketch");
        require(msg.value > 0, "tip 0");

        tipsPaid += msg.value;
        artistEarned[s.artist] += msg.value;

        (bool ok, ) = payable(s.artist).call{value: msg.value}("");
        require(ok, "tip failed");
        emit Tipped(sketchId, msg.sender, s.artist, msg.value);
    }

    // ── set maintenance (so views return only current/active, with no duplicates) ──
    function _addOwned(address who, uint256 eid) private {
        _owned[who].push(eid);
        _ownedIdx[eid] = _owned[who].length; // 1-based
    }

    function _removeOwned(address who, uint256 eid) private {
        uint256 idx = _ownedIdx[eid];
        if (idx == 0) return;
        uint256[] storage arr = _owned[who];
        uint256 last = arr.length;
        if (idx != last) {
            uint256 moved = arr[last - 1];
            arr[idx - 1] = moved;
            _ownedIdx[moved] = idx;
        }
        arr.pop();
        _ownedIdx[eid] = 0;
    }

    function _addListed(uint256 eid) private {
        if (_listedIdx[eid] != 0) return;
        _listed.push(eid);
        _listedIdx[eid] = _listed.length; // 1-based
    }

    function _removeListed(uint256 eid) private {
        uint256 idx = _listedIdx[eid];
        if (idx == 0) return;
        uint256 last = _listed.length;
        if (idx != last) {
            uint256 moved = _listed[last - 1];
            _listed[idx - 1] = moved;
            _listedIdx[moved] = idx;
        }
        _listed.pop();
        _listedIdx[eid] = 0;
    }

    // ── views ──────────────────────────────────────────────
    function getSketch(uint256 id) external view returns (Sketch memory) { return sketches[id]; }
    function getEdition(uint256 id) external view returns (Edition memory) { return editions[id]; }
    function sketchesOf(address a) external view returns (uint256[] memory) { return _byArtist[a]; }
    function ownedEditions(address a) external view returns (uint256[] memory) { return _owned[a]; }
    function listedEditions() external view returns (uint256[] memory) { return _listed; }
    function listedCount() external view returns (uint256) { return _listed.length; }
}
