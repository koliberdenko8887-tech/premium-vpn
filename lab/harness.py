# Acts like the Android app: opens a TUN, hands its fd to the core over an abstract socket.
import os, sys, fcntl, struct, socket, json, subprocess, time, array
TUNSETIFF=0x400454ca; IFF_TUN=1; IFF_NO_PI=0x1000
fd=os.open('/dev/net/tun', os.O_RDWR)
fcntl.ioctl(fd, TUNSETIFF, struct.pack('16sH', b'pvtun0', IFF_TUN|IFF_NO_PI))
def sh(c): subprocess.run(c, shell=True, check=True)
sh('ip netns add cli 2>/dev/null || true')
sh('ip link set pvtun0 netns cli')
sh('ip netns exec cli ip addr add 172.19.0.1/30 dev pvtun0')
sh('ip netns exec cli ip link set pvtun0 up mtu 9000')
sh('ip netns exec cli ip link set lo up')
sh('ip netns exec cli ip route add default dev pvtun0')
name='pvlab%d'%os.getpid()
srv=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); srv.bind('\0'+name); srv.listen(1)
link=sys.argv[1]
parsed=json.loads(subprocess.run(['../core/pvcore-host','parse'],input=link.encode(),capture_output=True).stdout)
server=parsed['Servers'][0]
settings={'logLevel':'warning','blockList':'blocked.example','directList':'198.18.9.9','autoReconnect':True}
json.dump({'server':server,'ctl':name,'data':os.getcwd(),'settings':settings}, open('params.json','w'))
env=dict(os.environ, PV_CHECK_URL='http://198.18.5.5/generate_204', PV_TRACE_URL='http://198.18.5.5/trace')
p=subprocess.Popen(['../core/pvcore-host','run','params.json'], env=env)
c,_=srv.accept()
idx=socket.if_nametoindex('eth0') if os.path.exists('/sys/class/net/eth0') else 1
st={'ifaces':[{'name':'eth0','index':idx,'mtu':1500,'addrs':['10.0.0.2/24'],'dns':['1.1.1.1'],'type':'ethernet'}],'default':'eth0'}
c.sendmsg([(json.dumps(st)+'\n').encode()], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i',[fd]))])
f=c.makefile('r')
t0=time.time()
for line in f:
    m=json.loads(line); 
    if m['t']!='traffic': print('core:', m, flush=True)
    if m['t']=='state' and m['s']=='on': break
    if m['t']=='err': sys.exit(1)
r=subprocess.run('ip netns exec cli curl -s -m 10 http://198.18.5.5/hello', shell=True, capture_output=True, text=True)
print('curl через туннель:', repr(r.stdout), r.returncode)
r=subprocess.run('ip netns exec cli curl -s -m 10 -o /dev/null http://198.18.5.5/big?', shell=True, capture_output=True, text=True)
time.sleep(1.5)
for line in f:
    m=json.loads(line)
    if m['t']=='traffic': print('счётчик:', m); break
time.sleep(2.5)
print('live.json:', open('live.json').read()[:300] if os.path.exists('live.json') else 'нет')
c.sendall(b'{"t":"stop"}\n')
print('exit', p.wait(timeout=10))
print('stats.json:', open('stats.json').read()[:300])
print('live.json после выхода:', os.path.exists('live.json'))
