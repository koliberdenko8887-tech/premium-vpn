import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(s):
        if 'generate_204' in s.path: s.send_response(204); s.end_headers(); return
        if 'trace' in s.path: b=b'ip=203.0.113.7\nloc=NL\n'; s.send_response(200); s.send_header('Content-Length',str(len(b))); s.end_headers(); s.wfile.write(b); return
        b=b'PREMIUM-OK '+s.path.encode(); s.send_response(200); s.send_header('Content-Length',str(len(b))); s.end_headers(); s.wfile.write(b)
    def log_message(*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1',8080),H).serve_forever()
