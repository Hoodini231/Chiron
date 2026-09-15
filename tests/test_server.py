import unittest
import tempfile
import threading
import json
import sys
from pathlib import Path
from http.client import HTTPConnection
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old=(server.RESULTS,server.STAGING)
        server.RESULTS=Path(self.temp.name)/'results';server.RESULTS.mkdir()
        server.STAGING=Path(self.temp.name)/'pending';server.STAGING.mkdir()
        self.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join()
        server.RESULTS,server.STAGING=self.old;self.temp.cleanup()
    def request(self,method,path,data=None,headers=None):
        conn=HTTPConnection('127.0.0.1',self.http.server_port)
        body=json.dumps(data).encode() if isinstance(data,dict) else data
        conn.request(method,path,body=body,headers=headers or {})
        result=conn.getresponse();status=result.status;body=result.read();conn.close()
        return status,body
    def test_recording_transaction_range_and_missing_key(self):
        report={'schema_version':'0.2','created_at':'2026-09-15T00:00:00Z','samples':[{'t_s':0,'pose':None,'hands':[],'ball':None}], 'metrics':{'duration_s':0}}
        status,body=self.request('POST','/api/results',{'report':report,'video_mime':'video/webm','raw_mime':'video/webm'})
        self.assertEqual(status,201);uid=json.loads(body)['id'];base='/api/results/'+uid
        self.assertEqual(self.request('POST',base+'/complete',{})[0],400)
        self.assertEqual(json.loads(self.request('GET','/api/results')[1])['results'],[])
        for name in ['processed.webm','original.webm']:
            self.assertEqual(self.request('PUT',base+'/'+name,b'0123456789')[0],200)
        self.assertEqual(self.request('POST',base+'/complete',{})[0],200)
        self.assertEqual(self.request('POST',base+'/complete',{})[0],200)
        self.assertTrue((server.RESULTS/uid/'data.json').exists())
        self.assertEqual(self.request('GET','/results/'+uid+'/processed.webm',headers={'Range':'bytes=2-5'}),(206,b'2345'))
        self.assertEqual(self.request('GET',base)[0],200)
        with patch.dict(server.os.environ,{'OPENAI_API_KEY':''}):
            self.assertEqual(self.request('POST',base+'/advice',{})[0],503)
    def test_reject_cross_origin_and_traversal(self):
        self.assertEqual(self.request('POST','/api/results',{},headers={'Origin':'https://example.com'})[0],403)
        self.assertEqual(self.request('GET','/../server.py')[0],403)
        self.assertEqual(self.request('POST','/api/results',{'report':{}})[0],400)

if __name__=='__main__':unittest.main()
