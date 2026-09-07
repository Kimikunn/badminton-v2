# mitmproxy addon：捕获小程序 token-user 请求头，写入运行时 token 文件
#
# 工作原理：手机把 Wi-Fi 代理指向本服务（8899 端口）后，小程序（川沙体育场）
# 的所有 HTTPS 流量经过本代理；凡带 token-user 头的请求，把 token 写到
# /token/gym-token（挂载自 server/runtime/）。App 每轮请求实时读该文件
# （intentService.readTokenUser），免重启生效。
#
# 换 token 的用户操作只有一步：小程序里重新登录（token 失效会跳登录页）。
from mitmproxy import http, ctx
import pathlib

GYM_HOST = 'shop.chuanshatiyuchang.cn'
OUT_FILE = pathlib.Path('/token/gym-token')

_last_token = None


def request(flow: http.HTTPFlow) -> None:
    global _last_token
    if flow.request.pretty_host != GYM_HOST:
        return
    token = (flow.request.headers.get('token-user') or '').strip()
    if not token or token == _last_token:
        return
    _last_token = token
    try:
        current = OUT_FILE.read_text().strip() if OUT_FILE.exists() else ''
    except OSError:
        current = ''
    if token == current:
        ctx.log.info('token-user 无变化，跳过写入')
        return
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(token)
    ctx.log.info(f'捕获到新 token-user（{len(token)} 字符），已写入 {OUT_FILE}')
