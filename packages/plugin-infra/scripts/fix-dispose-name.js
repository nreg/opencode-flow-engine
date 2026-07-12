const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'src', 'index.ts');
const content = fs.readFileSync(filePath, 'utf8');
const oldLine = "          console.warn(`[sFlow] Failed to stop MCP server ${name}: `, err);";
const newLine = "          console.warn(`[sFlow] Failed to stop MCP server ${server.name}: `, err);";
if (content.includes(oldLine)) {
  const updated = content.replace(oldLine, newLine);
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log('Fixed ${name} -> ${server.name} in dispose catch block');
} else {
  console.log('Target line not found');
}
