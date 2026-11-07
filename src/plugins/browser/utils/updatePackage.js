const fs = require("fs");
const path = require("path");

const configXML = path.resolve(__dirname, "../../../config.xml");
const menuJava = path.resolve(
  __dirname,
  "../../../platforms/android/app/src/main/java/com/foxdebug/browser/Menu.java"
);
const docProvider = path.resolve(
  __dirname,
  "../../../platforms/android/app/src/main/java/com/foxdebug/acode/rk/exec/terminal/AlpineDocumentProvider.java"
);

const repeatChar = (char, times) => char.repeat(times);

function replaceImport(filePath, applicationId) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠ File not found: ${filePath}`);
    return;
  }

  const data = fs.readFileSync(filePath, "utf8");

  // Rewrites the app's generated R-class import to match whatever the
  // actual applicationId (config.xml's widget id) is. This used to assume
  // the id was always "com.foxdebug.acode" or "com.foxdebug.acodefree"
  // (only the last segment ever changed), which broke once the id moved to
  // a different top-level namespace - so this now matches ANY previously
  // generated "import <id>.R;" line, not just the foxdebug ones, and
  // replaces it with the current full id.
  const updated = data.replace(
    /import\s+[0-9a-zA-Z.\-_]+\.R;/,
    `import ${applicationId}.R;`
  );

  fs.writeFileSync(filePath, updated);
}

try {
  if (!fs.existsSync(configXML)) {
    throw new Error("config.xml not found");
  }

  const config = fs.readFileSync(configXML, "utf8");
  const match = /widget\s+id="([0-9a-zA-Z.\-_]+)"/.exec(config);

  if (!match) {
    throw new Error("Could not extract widget id from config.xml");
  }

  const applicationId = match[1];

  replaceImport(docProvider, applicationId);
  replaceImport(menuJava, applicationId);

  const msg = `==== Changed package to ${applicationId} ====`;

  console.log("\n" + repeatChar("=", msg.length));
  console.log(msg);
  console.log(repeatChar("=", msg.length) + "\n");

} catch (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}