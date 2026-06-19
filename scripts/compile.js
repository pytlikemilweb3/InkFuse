const fs = require("fs");
const path = require("path");
const solc = require("solc");

const source = fs.readFileSync(path.join(__dirname, "../contracts/InkFuse.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "InkFuse.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors) {
  let fatal = false;
  for (const e of out.errors) {
    console.log(e.formattedMessage);
    if (e.severity === "error") fatal = true;
  }
  if (fatal) process.exit(1);
}

const c = out.contracts["InkFuse.sol"]["InkFuse"];
const rawVersion = solc.version();
const shortVersion = "v" + rawVersion.replace(/\.Emscripten.*$/, "");

const build = {
  contractName: "InkFuse",
  compilerVersion: shortVersion,
  evmVersion: "paris",
  optimizer: { enabled: true, runs: 200 },
  abi: c.abi,
  bytecode: "0x" + c.evm.bytecode.object,
  source,
};

fs.writeFileSync(path.join(__dirname, "../lib/inkfuse_build.json"), JSON.stringify(build, null, 2));
console.log("compiler:", shortVersion);
console.log("bytecode length:", build.bytecode.length);
console.log("abi entries:", c.abi.length);
console.log("→ lib/inkfuse_build.json");
