# MCP Server 鎺ュ叆璇存槑

`nebula-memory` 鎻愪緵涓€涓?*闆朵緷璧栫殑 MCP Server**锛岃 Claude Desktop / Cursor / Windsurf 绛変换浣?MCP 瀹㈡埛绔竴閿帴鍏ヨ繖濂楄蹇嗗紩鎿庛€?
> **褰撳墠鐗堟湰锛氱函鏈湴鐗?*銆傚彧鎺ユ湰鍦板洓鑷傚紩鎿庯紙NebulaMemory锛夛紝闆朵緷璧栥€侀浂鑺辫垂銆佷笉鑱旂綉銆佷笉涓婁簯銆?> **Hindsight 璇箟澧炲己鐗堬細鍚庣画璺熻繘**锛堟殏鏈彁渚涳級銆?
---

## 蹇€熸帴鍏ワ紙Claude Desktop锛?
### 1. clone 浠撳簱

```bash
git clone https://github.com/yb-zhai/agent-memory.git
```

### 2. 缂栬緫 Claude Desktop 閰嶇疆

鎵撳紑 Claude Desktop 鐨勯厤缃枃浠?`claude_desktop_config.json`锛堜笉鍚岀郴缁熶綅缃笉鍚岋級锛屽姞鍏ワ細

```json
{
  "mcpServers": {
    "nebula-memory": {
      "command": "node",
      "args": ["C:\\瀹屾暣璺緞\\agent-memory\\mcp-server.mjs"],
      "env": {
        "NEBULA_DATA_DIR": "C:\\瀹屾暣璺緞\\memory-data"
      }
    }
  }
}
```

- `command`锛氫綘鐨?Node 鍙墽琛屾枃浠讹紙閫氬父 `node`锛夛紱
- `args`锛氭寚鍚?`mcp-server.mjs` 鐨?*缁濆璺緞**锛?- `NEBULA_DATA_DIR`锛堝彲閫夛級锛氳蹇嗘暟鎹殑瀛樻斁鐩綍锛屼笉濉垯榛樿 `~/.agent-memory`銆?
### 3. 閲嶅惎 Claude Desktop

閲嶅惎鍚庯紝Claude 浼氳嚜鍔ㄨ繛涓?MCP Server锛屼綘灏辫兘鍦ㄥ璇濅腑璁?Claude 浣跨敤璁板繂浜嗐€?
---

## 鎻愪緵鐨勫伐鍏?
| 宸ュ叿 | 浣滅敤 | 鍙傛暟 |
|---|---|---|
| `remember` | 鍐欏叆涓€鏉¤蹇?| `text`锛堝繀濉級銆乣kind`銆乣importance`锛?.0=姘镐箙缃《锛夈€乣tags` |
| `recall` | 鍙洖鐩稿叧璁板繂 | `query`锛堝繀濉級銆乣limit` |
| `stats` | 璁板繂搴撶粺璁?| 鏃?|
| `forget` | 鎸?id 鍒犻櫎 | `id`锛堝繀濉級 |

---

## 鐜鍙橀噺

| 鍙橀噺 | 璇存槑 | 榛樿 |
|---|---|---|
| `NEBULA_DATA_DIR` | 璁板繂鏁版嵁鐩綍 | `~/.agent-memory` |
| `MEMORY_NEBULA_DATA_DIR` | 鍚屼笂锛堝吋瀹?DSH 鎻掍欢鍛藉悕锛?| 鈥?|

---

## 娴嬭瘯锛堢‘璁?MCP 姝ｅ父宸ヤ綔锛?
```bash
node mcp-server.mjs
```

鐒跺悗鎵嬪姩杈撳叆涓€琛?JSON-RPC锛堝洖杞︼級锛?
```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

搴旇繑鍥炲洓涓伐鍏风殑瀹氫箟銆?
---

## 绾湰鍦?vs Hindsight 澧炲己

| | 绾湰鍦扮増锛堝綋鍓嶏級 | Hindsight 澧炲己鐗堬紙鍚庣画锛?|
|---|---|---|
| 渚濊禆 | 闆?| 闇€ Postgres + LLM |
| 鎴愭湰 | 闆?| 鏈?LLM 璁¤垂 |
| 鑳藉姏 | 鍥涜噦鍙洖锛堣瘝娉?婵€娲?鍥炬墿鏁?鐢诲儚锛?| + 璇箟妫€绱?|
| 鐘舵€?| 鉁?宸叉彁渚?| 鈴?璺熻繘涓?|
