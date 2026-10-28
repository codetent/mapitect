# Dev-only static server that disables caching so rebuilt bundles always load.
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5317
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
