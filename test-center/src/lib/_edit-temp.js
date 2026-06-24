const fs = require('fs');
const path = 'e:\\trde-kaifa\\aiceshi-html\\test-center\\src\\lib\\advanced-retest.ts';
let c = fs.readFileSync(path, 'utf8');
let edits = 0;

function rep(oldStr, newStr, label) {
  if (c.includes(oldStr)) {
    c = c.replace(oldStr, newStr);
    edits++;
    console.log('OK: ' + label);
  } else {
    console.log('MISS: ' + label);
  }
}

// ============ executeRealLayer2 ============
// Signature
rep(
  'async function executeRealLayer2(\n  ctx: RealAdvancedRetestContext,\n  onProgress?: AdvancedRetestProgressCallback,\n): Promise<AdvancedRetestResult["layer2"]> {',
  'async function executeRealLayer2(\n  ctx: RealAdvancedRetestContext,\n  onProgress?: AdvancedRetestProgressCallback,\n  shouldAbort?: () => boolean,\n): Promise<AdvancedRetestResult["layer2"]> {',
  'layer2 sig'
);

// do { + first abort check
rep(
  '  const details: AdvancedRetestResult["layer2"]["details"] = [];\n\n  // REG-L2-001: \u9996\u6b21\u7b7e\u5230\u6210\u529f\uff0c\u79ef\u5206 +10\n  {',
  '  const details: AdvancedRetestResult["layer2"]["details"] = [];\n\n  do {\n  if (shouldAbort?.()) break;\n  // REG-L2-001: \u9996\u6b21\u7b7e\u5230\u6210\u529f\uff0c\u79ef\u5206 +10\n  {',
  'layer2 do{'
);

// Abort checks before cases 002-010
rep('  // REG-L2-002: \u7b7e\u5230\u540e\u79ef\u5206\u6b63\u786e\u589e\u52a0\uff08\u590d\u7528\u4e0a\u9762\u7684\u903b\u8f91\uff0c\u7b80\u5316\u4e3a\u67e5\u8be2\u79ef\u5206\uff09',
    '  if (shouldAbort?.()) break;\n  // REG-L2-002: \u7b7e\u5230\u540e\u79ef\u5206\u6b63\u786e\u589e\u52a0\uff08\u590d\u7528\u4e0a\u9762\u7684\u903b\u8f91\uff0c\u7b80\u5316\u4e3a\u67e5\u8be2\u79ef\u5206\uff09', 'layer2 case2');
rep('  // REG-L2-003: \u7b7e\u5230\u540e\u6309\u94ae\u53d8\u7070\uff08\u901a\u8fc7 API \u72b6\u6001\u5224\u65ad\uff09',
    '  if (shouldAbort?.()) break;\n  // REG-L2-003: \u7b7e\u5230\u540e\u6309\u94ae\u53d8\u7070\uff08\u901a\u8fc7 API \u72b6\u6001\u5224\u65ad\uff09', 'layer2 case3');
rep('  // REG-L2-004: \u8fde\u7eed\u7b7e\u5230\u5956\u52b1\uff08\u6f14\u793a\u9879\u76ee\u65e0\u6b64\u529f\u80fd\uff0c\u9ed8\u8ba4\u901a\u8fc7\uff09',
    '  if (shouldAbort?.()) break;\n  // REG-L2-004: \u8fde\u7eed\u7b7e\u5230\u5956\u52b1\uff08\u6f14\u793a\u9879\u76ee\u65e0\u6b64\u529f\u80fd\uff0c\u9ed8\u8ba4\u901a\u8fc7\uff09', 'layer2 case4');
rep('  // REG-L2-005: \u91cd\u65b0\u767b\u5f55\u540e\u7b7e\u5230\u72b6\u6001\u4fdd\u6301',
    '  if (shouldAbort?.()) break;\n  // REG-L2-005: \u91cd\u65b0\u767b\u5f55\u540e\u7b7e\u5230\u72b6\u6001\u4fdd\u6301', 'layer2 case5');
rep('  // REG-L2-006: \u7b2c\u4e8c\u5929\u53ef\u518d\u6b21\u7b7e\u5230\uff08\u65e0\u6cd5\u771f\u5b9e\u6a21\u62df\u8de8\u5929\uff0c\u9ed8\u8ba4\u901a\u8fc7\uff09',
    '  if (shouldAbort?.()) break;\n  // REG-L2-006: \u7b2c\u4e8c\u5929\u53ef\u518d\u6b21\u7b7e\u5230\uff08\u65e0\u6cd5\u771f\u5b9e\u6a21\u62df\u8de8\u5929\uff0c\u9ed8\u8ba4\u901a\u8fc7\uff09', 'layer2 case6');
rep('  // REG-L2-007: \u5151\u6362\u5956\u52b1\u540e\u79ef\u5206\u6b63\u786e\u6263\u51cf',
    '  if (shouldAbort?.()) break;\n  // REG-L2-007: \u5151\u6362\u5956\u52b1\u540e\u79ef\u5206\u6b63\u786e\u6263\u51cf', 'layer2 case7');
rep('  // REG-L2-008: \u5151\u6362\u540e\u5e93\u5b58\u6b63\u786e\u6263\u51cf\uff08\u65e0\u6cd5\u76f4\u63a5\u9a8c\u8bc1\u5e93\u5b58\uff0c\u9ed8\u8ba4\u901a\u8fc7\uff09',
    '  if (shouldAbort?.()) break;\n  // REG-L2-008: \u5151\u6362\u540e\u5e93\u5b58\u6b63\u786e\u6263\u51cf\uff08\u65e0\u6cd5\u76f4\u63a5\u9a8c\u8bc1\u5e93\u5b58\uff0c\u9ed8\u8ba4\u901a\u8fc7\uff09', 'layer2 case8');
rep('  // REG-L2-009: \u5173\u5361\u89e3\u9501\u903b\u8f91\u6b63\u5e38',
    '  if (shouldAbort?.()) break;\n  // REG-L2-009: \u5173\u5361\u89e3\u9501\u903b\u8f91\u6b63\u5e38', 'layer2 case9');
rep('  // REG-L2-010: \u7b54\u9898\u79ef\u5206\u53d1\u653e\u6b63\u5e38',
    '  if (shouldAbort?.()) break;\n  // REG-L2-010: \u7b54\u9898\u79ef\u5206\u53d1\u653e\u6b63\u5e38', 'layer2 case10');

// } while (false); before return
rep(
  '  onProgress?.("layer2", 10, 10, "\u7b2c\u4e8c\u5c42\u5b8c\u6210");\n\n  return {',
  '  onProgress?.("layer2", 10, 10, "\u7b2c\u4e8c\u5c42\u5b8c\u6210");\n  } while (false);\n\n  return {',
  'layer2 }while'
);

// ============ executeRealLayer3 ============
// Signature
rep(
  'async function executeRealLayer3(\n  ctx: RealAdvancedRetestContext,\n  layer1: AdvancedRetestResult["layer1"],\n  onProgress?: AdvancedRetestProgressCallback,\n): Promise<AdvancedRetestResult["layer3"]> {',
  'async function executeRealLayer3(\n  ctx: RealAdvancedRetestContext,\n  layer1: AdvancedRetestResult["layer1"],\n  onProgress?: AdvancedRetestProgressCallback,\n  shouldAbort?: () => boolean,\n): Promise<AdvancedRetestResult["layer3"]> {',
  'layer3 sig'
);

// do { + first abort check
rep(
  '  let idx = 0;\n  const total = 15;\n\n  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u73af\u5883\u4e0e\u542f\u52a8\n  {',
  '  let idx = 0;\n  const total = 15;\n\n  do {\n  if (shouldAbort?.()) break;\n  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u73af\u5883\u4e0e\u542f\u52a8\n  {',
  'layer3 do{'
);

// Abort checks before remaining cases
rep('  // \u57fa\u7840\u6d4b\u8bd5\uff1aAPI \u8fde\u901a\u6027\n  {',
    '  if (shouldAbort?.()) break;\n  // \u57fa\u7840\u6d4b\u8bd5\uff1aAPI \u8fde\u901a\u6027\n  {', 'layer3 case2');
rep('  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u6ce8\u518c\u4e3b\u8def\u5f84\n  {',
    '  if (shouldAbort?.()) break;\n  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u6ce8\u518c\u4e3b\u8def\u5f84\n  {', 'layer3 case3');
rep('  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u8868\u5355\u6821\u9a8c\n  {',
    '  if (shouldAbort?.()) break;\n  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u8868\u5355\u6821\u9a8c\n  {', 'layer3 case4');
rep('  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u6570\u636e\u6301\u4e45\u5316\uff08Bug 5 \u9a8c\u8bc1\uff09\n  {',
    '  if (shouldAbort?.()) break;\n  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u6570\u636e\u6301\u4e45\u5316\uff08Bug 5 \u9a8c\u8bc1\uff09\n  {', 'layer3 case5');
rep('  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u6743\u9650\u6821\u9a8c\n  {',
    '  if (shouldAbort?.()) break;\n  // \u57fa\u7840\u6d4b\u8bd5\uff1a\u6743\u9650\u6821\u9a8c\n  {', 'layer3 case6');
rep('  // \u4e1a\u52a1\u6d4b\u8bd5\uff1a\u7b7e\u5230\u4e3b\u8def\u5f84\n  {',
    '  if (shouldAbort?.()) break;\n  // \u4e1a\u52a1\u6d4b\u8bd5\uff1a\u7b7e\u5230\u4e3b\u8def\u5f84\n  {', 'layer3 case7');
rep('  // \u4e1a\u52a1\u6d4b\u8bd5\uff1a\u8de8\u529f\u80fd\u7efc\u5408\u9a8c\u8bc1\n  {',
    '  if (shouldAbort?.()) break;\n  // \u4e1a\u52a1\u6d4b\u8bd5\uff1a\u8de8\u529f\u80fd\u7efc\u5408\u9a8c\u8bc1\n  {', 'layer3 case8');
rep('  // \u5df2\u4fee\u590d\u95ee\u9898\u9a8c\u8bc1\uff1a\u6839\u636e\u7b2c\u4e00\u5c42\u7ed3\u679c\u586b\u5145\n  {',
    '  if (shouldAbort?.()) break;\n  // \u5df2\u4fee\u590d\u95ee\u9898\u9a8c\u8bc1\uff1a\u6839\u636e\u7b2c\u4e00\u5c42\u7ed3\u679c\u586b\u5145\n  {', 'layer3 case9');
rep('  // \u9632\u56de\u5f52\u7528\u4f8b\n  {',
    '  if (shouldAbort?.()) break;\n  // \u9632\u56de\u5f52\u7528\u4f8b\n  {', 'layer3 case10');

// } while (false); before return
rep(
  '    });\n  }\n\n  return {\n    title: "\u7b2c\u4e09\u5c42 \u00b7 \u7efc\u5408\u56de\u5f52",',
  '    });\n  }\n  } while (false);\n\n  return {\n    title: "\u7b2c\u4e09\u5c42 \u00b7 \u7efc\u5408\u56de\u5f52",',
  'layer3 }while'
);

fs.writeFileSync(path, c, 'utf8');
console.log('\nTotal edits applied: ' + edits);
