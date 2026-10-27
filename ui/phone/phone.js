// Премиум VPN for Android: the Windows page runs as is, this file gives it the same pvXxx functions
// the Windows app binds (go-webview2), on top of window.PV (MainActivity.Bridge) and localStorage.
(function(){
  var PV=window.PV||demoPV();
  var VERSION=(PV.version&&PV.version())||"демо";
  // [id, name, bar colour, 3D: platform on, platform off, glow, ring, colour of the hero's red parts]
  window.PV_THEMES=[["ace","Красный туз","#060606",{on:"#9e0a1d",off:"#3a0e14",glow:"#ff1a33",gi:.45,ring:"#ffffff",env:.4,coat:.45,tint:""}],
    ["ocean","Океан и пламя","#0f2035",{on:"#ff7a1f",off:"#22344a",glow:"#ff6a00",ring:"#f7f3ec",env:.4,coat:.45,tint:"#ff7a1f"}],
    ["bordo","Бордо и роса","#5a1027",{on:"#e4dfe2",off:"#4a2532",glow:"#ffd6e0",ring:"#7d1a38",env:.4,coat:.45,tint:"#e9e4e7"}],
    ["gold","Чёрное золото","#0b0b0c",{on:"#d4a94a",off:"#2e2618",glow:"#f2c14e",ring:"#1a1408",env:.4,coat:.45,tint:"#e0b55a"}],
    ["lava","Лава","#0a0a0a",{on:"#ff6a00",off:"#3a2210",glow:"#ff5a00",ring:"#111111",env:.4,coat:.45,tint:"#ff7400"}],
    ["indigo","Индиго","#0d0a26",{on:"#7d5cff",off:"#241d4d",glow:"#8f72ff",ring:"#ffffff",env:.4,coat:.45,tint:"#8466ff"}]];
  window.H3D_MAX_DPR=3;window.H3D_SNAP_DPR=2; // sharp people on phone screens
  var CREW={ace:"Красные тузы",ocean:"Огни океана",bordo:"Бордовая роса",gold:"Золотая гвардия",lava:"Лавовый поток",indigo:"Индиго"};
  function route(s){var p=[];if(s.tun)p.push("TUN ("+({gvisor:"gVisor",system:"системный",mixed:"смешанный"}[s.tunStack]||"gVisor")+")");
    if(s.systemProxy)p.push("Прокси 127.0.0.1:"+(s.proxyPort||20808));return p.join(" + ")+(s.localDns?" · локальный DNS":"")}

  // ---- store: servers, subscriptions, settings (localStorage, like 0.1.0) ----
  var DEF={autoConnect:false,autoReconnect:true,localDns:false,remoteDns:"https://1.1.1.1/dns-query",directDns:"",ipMode:"ipv4_only",
    globalProxy:true,bypassLan:true,sniff:true,directList:"",proxyList:"",blockList:"",appMode:"all",apps:"",
    fragment:false,fragPackets:"tlshello",fragLength:"100-200",fragInterval:"10-20",noises:false,noiseType:"rand",noisePacket:"10-20",noiseDelay:"10-16",
    mux:false,muxConc:8,xudpConc:16,xudpQuic:"reject",pingType:"tcp",pingUrl:"https://www.gstatic.com/generate_204",pingOnStart:true,sortByPing:false,
    subAutoUpdate:true,subInterval:12,subUpdateOnStart:false,subUserAgent:"",sendHwid:true,logLevel:"warning",heroButton:true,heroHop:true,game:"",
    // TUN = Android's VPN for the whole phone, systemProxy = «Прокси» on 127.0.0.1; the page's «движок TUN» is the stack here
    systemProxy:false,tun:true,tunEngine:"gvisor",tunStack:"gvisor",proxyPort:20808,allowLan:false,strictRoute:true,tunMtu:9000};
  // changes that do not need a new connection
  var QUIET={autoConnect:1,autoReconnect:1,pingType:1,pingUrl:1,pingOnStart:1,sortByPing:1,subAutoUpdate:1,subInterval:1,subUpdateOnStart:1,subUserAgent:1,sendHwid:1,heroButton:1,heroHop:1,game:1};
  function jp(t,d){try{var v=JSON.parse(t);return v==null?d:v}catch(e){return d}}
  function ls(k){try{return localStorage.getItem(k)}catch(e){return null}}
  var db=jp(ls("pv2"),null);
  if(!db){ // 0.1.0 kept pv.subs, pv.servers, pv.sel (a name) and pv.set
    db={servers:jp(ls("pv.servers"),[]),subs:jp(ls("pv.subs"),[]),selected:"",settings:{}};
    var old=jp(ls("pv.set"),{}),sel=jp(ls("pv.sel"),"");
    if(old.localDns)db.settings.localDns=true;if(old.bypassLan===false)db.settings.bypassLan=false;if(old.remoteDns)db.settings.remoteDns=old.remoteDns;if(old.debug)db.settings.logLevel="debug";
    db.servers.forEach(function(s,i){if(!s.id)s.id="m"+i;if(s.name===sel)db.selected=s.id});
  }
  db.servers=db.servers||[];db.subs=db.subs||[];db.settings=db.settings||{};
  db.subs.forEach(function(x){if(x.updated>1e12)x.updated=Math.floor(x.updated/1000)}); // 0.1.0 kept milliseconds
  function settings(){var s={};for(var k in DEF)s[k]=DEF[k];for(k in db.settings)s[k]=db.settings[k];return s}
  function save(){try{localStorage.setItem("pv2",JSON.stringify(db))}catch(e){}}
  save();
  function env(){var s=settings();if(PV.env)PV.env(s.subUserAgent||"",!!s.sendHwid)}
  env();

  var cbs={},cbn=0,notice="",noticeId=1,pinging=false;
  function call(cmd,arg){return new Promise(function(res){var id="c"+(++cbn);cbs[id]=res;PV.call(cmd,arg,id)})}
  window.pvCb=function(id,data){var f=cbs[id];delete cbs[id];if(f)f(jp(data,{error:"Ядро ответило непонятно"}))};
  function say(t){notice=t;noticeId++}

  // ---- connection ----
  function vs(){return jp(PV.state(),{s:"off"})}
  function active(v){v=v||vs();return v.s==="on"||v.s==="weak"||v.s==="connecting"||v.s==="reconnecting"}
  function current(){for(var i=0;i<db.servers.length;i++)if(db.servers[i].id===db.selected)return db.servers[i];return db.servers[0]||null}
  function coreSettings(){var s=settings(),o={};for(var k in s)if(k!=="game")o[k]=s[k];return o}
  function connect(){var s=current();if(!s){go("subs");say("Сначала добавьте сервер: вставьте ссылку на подписку");return}
    env();PV.connect(JSON.stringify({server:s,settings:coreSettings()}))}
  var again=0;function reconnectSoon(){clearTimeout(again);again=setTimeout(function(){if(active())connect()},700)}
  function go(p){var b=document.querySelector('.ri[data-p="'+p+'"]');if(b)b.click()}

  var NONE={id:"none",name:"Добавьте сервер",country:"",kind:"none",proto:"подписки или ссылки",ping:0};
  function view(s){return {id:s.id,name:s.name||s.host||"Сервер",country:s.country||"",kind:s.kind==="warp"?"link":(s.kind||"link"),proto:s.proto||"",ping:s.ping||0,subId:s.subId||""}}
  window.pvState=function(){
    var v=vs(),st=settings(),status={on:"on",connecting:"connecting",reconnecting:"reconnecting",weak:"reconnecting",error:"error"}[v.s]||"off";
    var c={status:status,serverId:v.id||db.selected,since:Math.floor((v.since||0)/1000),error:v.msg||"",
      busy:v.s==="connecting"?"Подключаюсь…":v.s==="weak"?"Сервер перестал отвечать, проверяю связь…":v.s==="reconnecting"?"Связь пропала, переподключаюсь…":"",
      ip:v.ip||"",loc:v.loc||"",down:v.rd||0,up:v.ru||0,method:"",route:route(st),notice:notice,noticeId:noticeId};
    var list=db.servers.length?db.servers.map(view):[NONE];
    quota();
    return Promise.resolve({conn:c,servers:list,subs:db.subs.map(function(x){return {id:x.id,title:x.title||"",url:x.url,count:db.servers.filter(function(s){return s.subId===x.id}).length,
        upload:x.upload||0,download:x.download||0,total:x.total||0,expire:x.expire||0,updated:x.updated||0}}),
      selected:(current()||NONE).id,settings:st,version:VERSION,pinging:pinging,elevated:true,engines:{gvisor:true,system:true,mixed:true},diag:{running:false,results:[]}});
  };
  window.pvToggle=function(){var v=vs();if(active(v))PV.disconnect();else connect();return Promise.resolve()};
  window.pvSelect=function(id){if(id==="none"){go("subs");return Promise.resolve()}
    if(db.selected!==id){db.selected=id;save();if(active())connect()}return Promise.resolve()};
  window.pvSet=function(k,v){if(k==="tunEngine"||k==="tunStack"){db.settings.tunEngine=db.settings.tunStack=v}else db.settings[k]=v;
    if(db.settings.tun===false&&!db.settings.systemProxy)db.settings.systemProxy=true;save();if(k==="subUserAgent"||k==="sendHwid")env();if(!QUIET[k]&&active())reconnectSoon();return Promise.resolve()};
  window.pvResetSettings=function(){db.settings={game:db.settings.game||""};save();env();if(active())reconnectSoon();return Promise.resolve()};

  // ---- servers and subscriptions ----
  function addSub(url){return call("sub",url).then(function(r){
    if(r.error)throw new Error(r.error);
    var x=null;db.subs.forEach(function(s){if(s.url===url)x=s});
    if(!x){x={id:"u"+Date.now().toString(36)+Math.floor(Math.random()*1e4),url:url};db.subs.push(x)}
    x.title=r.Title||x.title||"";x.upload=r.Upload||0;x.download=r.Download||0;x.total=r.Total||0;x.expire=r.Expire||0;x.updated=Math.floor(Date.now()/1000);
    var old={},wasSel=current();db.servers.forEach(function(s){if(s.subId===x.id)old[s.name]=s.ping});
    var list=(r.Servers||[]).map(function(s,i){s.subId=x.id;s.id=x.id+"-"+i;if(old[s.name])s.ping=old[s.name];return s});
    db.servers=db.servers.filter(function(s){return s.subId!==x.id}).concat(list);
    // the same server keeps being the chosen one after an update
    if(wasSel&&wasSel.subId===x.id){var same=list.filter(function(s){return s.name===wasSel.name})[0];db.selected=same?same.id:(list[0]||{}).id||""}
    if(!current()&&db.servers[0])db.selected=db.servers[0].id;
    save();return list.length})}
  window.pvAdd=function(text){
    var urls=text.split(/\s+/).filter(function(x){return /^https?:\/\//i.test(x)}),rest=text.split(/\s+/).filter(function(x){return x&&!/^https?:\/\//i.test(x)}).join("\n");
    say("Добавляю…");
    var jobs=urls.map(addSub);
    if(rest)jobs.push(call("parse",rest).then(function(r){
      var list=(r.Servers||[]).map(function(s,i){s.subId="";s.id="m"+Date.now().toString(36)+i;return s});
      if(!list.length)throw new Error((r.Errors&&r.Errors[0])||"Не нашёл серверов в тексте");
      db.servers=db.servers.concat(list);if(!current())db.selected=list[0].id;save();return list.length}));
    return Promise.all(jobs).then(function(n){var sum=n.reduce(function(a,b){return a+b},0);
      say(sum?"Добавлено серверов: "+sum:"В подписке пока нет серверов");return pingAll()}).catch(function(e){say(e.message||String(e))});
  };
  window.pvRefreshSub=function(id){var x=db.subs.filter(function(s){return s.id===id})[0];if(!x)return Promise.resolve();say("Обновляю подписку…");
    return addSub(x.url).then(function(n){say("Подписка обновлена: серверов "+n)}).catch(function(e){say(e.message)})};
  window.pvRemoveSub=function(id){db.subs=db.subs.filter(function(s){return s.id!==id});db.servers=db.servers.filter(function(s){return s.subId!==id});
    if(!current()&&db.servers[0])db.selected=db.servers[0].id;save();return Promise.resolve()};
  window.pvRemoveServer=function(id){db.servers=db.servers.filter(function(s){return s.id!==id});if(!current()&&db.servers[0])db.selected=db.servers[0].id;save();return Promise.resolve()};
  function pingAll(){
    if(!db.servers.length||pinging)return Promise.resolve();pinging=true;
    var real=settings().pingType==="real",
      job=real?call("rping",JSON.stringify({settings:coreSettings(),servers:db.servers})):call("ping",JSON.stringify(db.servers.map(function(s){return {id:s.id,host:s.host,port:s.port}})));
    return job.then(function(r){db.servers.forEach(function(s){if(r[s.id]!=null)s.ping=r[s.id]});
      // nothing chosen by hand yet and the first server is down: take the fastest
      var cur=current();if(cur&&!(cur.ping>0)&&!active()){var best=null;db.servers.forEach(function(s){if(s.ping>0&&(!best||s.ping<best.ping))best=s});if(best)db.selected=best.id}
      save()}).catch(function(){}).then(function(){pinging=false})}
  window.pvPing=function(){pingAll();return Promise.resolve()};
  function refreshAll(){return Promise.all(db.subs.map(function(x){return addSub(x.url).catch(function(e){say(e.message)})})).then(pingAll)}
  window.pvRefreshAll=function(){pinging=true;refreshAll().then(function(){pinging=false});return Promise.resolve()};

  // ---- statistics, logs, look ----
  window.pvStats=function(){
    var st=jp(PV.data("stats.json"),{}),lv=jp(PV.data("live.json"),null),on=active();
    if(!on||!lv||Date.now()/1000-(lv.updated||0)>15)lv={};
    var days=st.days||[],today=new Date(),p=function(n){return (n<10?"0":"")+n};
    var dk=today.getFullYear()+"-"+p(today.getMonth()+1)+"-"+p(today.getDate()),mk=dk.slice(0,7),t={down:0,up:0},m={down:0,up:0};
    days.forEach(function(d){if(d.day===dk)t=d;if(d.day.slice(0,7)===mk){m.down+=d.down;m.up+=d.up}});
    var srv=[];for(var k in st.servers||{})srv.push(st.servers[k]);srv.sort(function(a,b){return b.down+b.up-a.down-a.up});
    return Promise.resolve({today:t,month:m,totalDown:st.totalDown||0,totalUp:st.totalUp||0,sessions:st.sessions||0,seconds:st.seconds||0,
      days:days.slice(-30),servers:srv.slice(0,12),sessDown:lv.sessDown||0,sessUp:lv.sessUp||0,sessSince:lv.sessSince||0,speed:lv.speed||[],
      conns:lv.conns||[],connCount:lv.connCount||0});
  };
  window.pvResetStats=function(){PV.resetStats();return Promise.resolve()};
  window.pvLog=function(n){return Promise.resolve({name:n,text:PV.log()})};
  window.pvClearLogs=function(){PV.clearLogs();return Promise.resolve()};
  window.pvTheme=function(t){var x=PV_THEMES.filter(function(q){return q[0]===t})[0];if(!x)return;
    if(PV.theme)PV.theme(x[2]);if(window.Hero3D&&Hero3D.setTheme)Hero3D.setTheme(x[3]);
    var h=document.querySelector(".gbanner h2");if(h)h.textContent=CREW[t]||CREW.ace;
    if(window.pvRethumb)pvRethumb()};
  window.pvModelPart=function(i){return PV.modelPart(i)};
  window.pvVpnSettings=function(){PV.vpnSettings()};
  ["pvOpenData","pvResetWarp","pvImportHapp","pvRestartAdmin","pvDiagnose","pvResetNetwork"].forEach(function(n){window[n]=function(){return Promise.resolve()}});

  // ---- «Осталось … ГБ» under the server ----
  function gb(b){var g=b/1073741824;return (g>=100?Math.round(g):g>=10?g.toFixed(0):g.toFixed(1)).toString().replace(".",",")+" ГБ"}
  function quota(){
    var el=document.getElementById("quota");if(!el)return;
    var s=current(),x=s&&s.subId&&db.subs.filter(function(q){return q.id===s.subId})[0],t="";
    if(x){var used=(x.upload||0)+(x.download||0),p=[];
      if(x.total>0)p.push("Осталось <b>"+gb(Math.max(0,x.total-used))+"</b> из "+gb(x.total));else if(used)p.push("Израсходовано <b>"+gb(used)+"</b> · без лимита");else p.push("Трафик без лимита");
      if(x.expire>0){var d=Math.ceil((x.expire*1000-Date.now())/864e5);p.push(d>0?"ещё "+d+" "+(d%10===1&&d%100!==11?"день":d%10>=2&&d%10<=4&&(d%100<12||d%100>14)?"дня":"дней"):"срок вышел")}
      t=p.join(" · ");
      if(x.total>0){var left=Math.max(0,Math.min(1,1-used/x.total));t+='<i class="qbar"><i style="width:'+(left*100).toFixed(1)+'%"></i></i>'}}
    if(el.innerHTML!==t)el.innerHTML=t;el.hidden=!t;
  }

  // ---- background work: subscriptions, ping, connect at start ----
  function stale(){var s=settings();if(!s.subAutoUpdate)return false;var h=Math.max(1,s.subInterval||12)*3600;
    return db.subs.some(function(x){return !x.updated||Date.now()/1000-x.updated>h})}
  setTimeout(function(){var s=settings();
    if(s.autoConnect&&!active()&&current())connect();
    if(db.subs.length&&(s.subUpdateOnStart||stale()))refreshAll();else if(s.pingOnStart)pingAll()},1200);
  setInterval(function(){if(stale())refreshAll()},600000);
  window.pvResume=function(){};

  // ---- phone layout: tab bar, «Ещё», the server list as a sheet ----
  document.addEventListener("DOMContentLoaded",function(){
    var rail=document.querySelector(".rail"),more=document.createElement("button");
    more.className="ri";more.type="button";more.setAttribute("aria-label","Ещё");
    more.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg><span class="tip">Ещё</span>';
    rail.insertBefore(more,document.getElementById("ver"));
    var MORE=[["subs","Подписки"],["stats","Статистика"],["shop","Кристаллы"],["logs","Журнал"]];
    var menu=sheet("moreSheet",'<div class="grab"></div><h4>Ещё</h4>'+MORE.map(function(m){var src=document.querySelector('.ri[data-p="'+m[0]+'"] svg');
      return '<button type="button" class="mi" data-to="'+m[0]+'">'+(src?src.outerHTML:"")+"<span>"+m[1]+"</span></button>"}).join(""));
    more.addEventListener("click",function(){openSheet(menu)});
    menu.addEventListener("click",function(e){var b=e.target.closest("[data-to]");if(!b)return;closeSheet();go(b.dataset.to)});
    function mark(p){more.classList.toggle("on",MORE.some(function(m){return m[0]===p}))}
    document.addEventListener("click",function(e){var b=e.target.closest(".ri[data-p],[data-go]");if(b)setTimeout(function(){mark(b.dataset.p||b.dataset.go)},0)});

    // the server list is a sheet from the bottom: «Сменить» opens it, a swipe down or a pick closes it
    var list=document.querySelector("#home .list");list.classList.add("sheet");list.insertAdjacentHTML("afterbegin",'<div class="grab"></div>');
    document.body.appendChild(list);
    document.getElementById("scroll").addEventListener("click",function(e){if(e.target.closest(".srv"))setTimeout(closeSheet,260)});
    window.pvSheet=function(){openSheet(list)};
    var q=document.createElement("div");q.className="quota";q.id="quota";q.hidden=true;
    document.getElementById("loc").insertAdjacentElement("afterend",q);
    quota();
  });
  var veil=null,openEl=null;
  function sheet(id,html){var d=document.createElement("div");d.className="glass sheet";d.id=id;d.innerHTML=html;document.body.appendChild(d);return d}
  function openSheet(el){
    if(!veil){veil=document.createElement("div");veil.className="veil";document.body.appendChild(veil);veil.addEventListener("click",closeSheet)}
    if(openEl&&openEl!==el)openEl.classList.remove("open");
    openEl=el;el.style.transform="";el.classList.add("open");veil.classList.add("show");swipe(el)}
  function closeSheet(){if(!openEl)return;openEl.style.transform="";openEl.classList.remove("open");openEl=null;if(veil)veil.classList.remove("show")}
  window.pvCloseSheet=closeSheet;
  function swipe(el){
    if(el.dataset.sw)return;el.dataset.sw="1";
    var y0=0,t0=0,dy=0,drag=false,ok=false,sc=null;
    el.addEventListener("touchstart",function(e){y0=e.touches[0].clientY;t0=Date.now();dy=0;drag=false;
      sc=e.target.closest(".scroll,.alist");ok=!sc||sc.scrollTop<=0},{passive:true});
    el.addEventListener("touchmove",function(e){if(!ok)return;dy=e.touches[0].clientY-y0;
      if(!drag&&dy>8){drag=true;el.classList.add("drag")}
      if(drag){if(e.cancelable)e.preventDefault();el.style.transform="translateY("+Math.max(0,dy)+"px)"}},{passive:false});
    el.addEventListener("touchend",function(){if(!drag)return;el.classList.remove("drag");drag=false;
      var fast=dy>40&&Date.now()-t0<250;if(dy>el.offsetHeight*.25||fast)closeSheet();else el.style.transform=""});
  }
  // Android's back button: a sheet first, then the main screen, then the phone's home screen
  window.pvBack=function(){if(openEl){closeSheet();return true}
    var on=document.querySelector(".page.on");if(on&&on.id!=="home"){go("home");return true}return false};

  // «Приложения»: pick apps from the phone's list
  window.pvPickApps=function(){
    var all=jp(PV.apps?PV.apps():"[]",[]),have={};(settings().apps||"").split(/[\s,;]+/).forEach(function(p){if(p)have[p]=1});
    var el=document.getElementById("appSheet")||sheet("appSheet","");
    el.innerHTML='<div class="grab"></div><h4>Приложения</h4><input class="in" id="appQ" placeholder="Поиск" autocomplete="off"><div class="alist" id="appL">'+
      (all.length?all.map(function(a){return '<button type="button" class="ap'+(have[a.p]?" on":"")+'" data-p="'+a.p+'"><span class="ck"></span><span><b></b><small>'+a.p+"</small></span></button>"}).join(""):'<div class="empty">Список приложений недоступен</div>')+
      '</div><div class="row"><button type="button" class="btn main" id="appOk">Готово</button></div>';
    el.querySelectorAll(".ap").forEach(function(b,i){b.querySelector("b").textContent=all[i].l});
    el.querySelector("#appL").addEventListener("click",function(e){var b=e.target.closest(".ap");if(!b)return;b.classList.toggle("on");if(b.classList.contains("on"))have[b.dataset.p]=1;else delete have[b.dataset.p]});
    el.querySelector("#appQ").addEventListener("input",function(){var v=this.value.toLowerCase();el.querySelectorAll(".ap").forEach(function(b){b.hidden=v&&b.textContent.toLowerCase().indexOf(v)<0})});
    el.querySelector("#appOk").addEventListener("click",function(){pvSet("apps",Object.keys(have).join("\n"));closeSheet()});
    openSheet(el);
  };

  // Background pictures of the four extra themes (the design page «VPN по вашим картинкам»)
  var noiseTile=null;
  function noise(ctx,alpha,rng){
    if(!noiseTile){noiseTile=document.createElement("canvas");noiseTile.width=noiseTile.height=128;var c=noiseTile.getContext("2d"),d=c.createImageData(128,128),r=rng(7);
      for(var i=0;i<d.data.length;i+=4){var v=r()*255|0;d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=255}c.putImageData(d,0,0)}
    ctx.save();ctx.globalAlpha=alpha;ctx.globalCompositeOperation="overlay";ctx.fillStyle=ctx.createPattern(noiseTile,"repeat");ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore()}
  function seeded(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  window.PV_PAINT={
    // «Красный туз» as on Windows, with the cards moved off the page titles of a tall screen
    ace:function(ctx,w,h){
      var g=ctx.createRadialGradient(w*.75,h*.35,0,w*.75,h*.35,h*.8);g.addColorStop(0,"#1b1b1c");g.addColorStop(1,"#030303");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
      function tile(dot,bg){var t=document.createElement("canvas");t.width=t.height=6;var c=t.getContext("2d");c.fillStyle=bg;c.fillRect(0,0,6,6);c.fillStyle=dot;c.beginPath();c.arc(3,3,1.2,0,6.283);c.fill();c.fillStyle="rgba(255,255,255,.08)";c.beginPath();c.arc(2.5,2.4,.5,0,6.283);c.fill();return ctx.createPattern(t,"repeat")}
      function card(cx,cy,cw,ch,rot,base,dot,edge){
        ctx.save();ctx.translate(cx,cy);ctx.rotate(rot);
        var x=-cw/2,y=-ch/2,rr=Math.min(cw,ch)*.06;ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+cw,y,x+cw,y+ch,rr);ctx.arcTo(x+cw,y+ch,x,y+ch,rr);ctx.arcTo(x,y+ch,x,y,rr);ctx.arcTo(x,y,x+cw,y,rr);ctx.closePath();
        ctx.shadowColor="rgba(0,0,0,.8)";ctx.shadowBlur=50;ctx.shadowOffsetX=-14;ctx.shadowOffsetY=10;ctx.fillStyle=base;ctx.fill();ctx.shadowColor="transparent";
        ctx.save();ctx.clip();ctx.fillStyle=tile(dot,base);ctx.fillRect(x,y,cw,ch);
        var sh=ctx.createLinearGradient(x,y,x+cw,y+ch);sh.addColorStop(0,"rgba(255,255,255,.1)");sh.addColorStop(.45,"rgba(255,255,255,0)");sh.addColorStop(1,"rgba(0,0,0,.35)");ctx.fillStyle=sh;ctx.fillRect(x,y,cw,ch);ctx.restore();
        ctx.strokeStyle=edge;ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
      }
      card(w*.02,h*1.02,w*.8,w*1.12,.42,"#e8132f","rgba(110,0,16,.55)","rgba(255,120,140,.5)");
      card(w*1.02,h*.5,w*.78,w*1.1,-.3,"#e8132f","rgba(110,0,16,.55)","rgba(255,120,140,.5)");
      card(w*1.16,h*.6,w*.78,w*1.1,-.3,"#0d0d0e","rgba(255,255,255,.07)","rgba(255,255,255,.12)");
    },
    bordo:function(ctx,w,h,r){
      var g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,"#6e1532");g.addColorStop(.5,"#811c3b");g.addColorStop(1,"#4a0b1f");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
      var v=ctx.createRadialGradient(w*.45,h*.4,0,w*.45,h*.4,Math.max(w,h)*.7);v.addColorStop(0,"rgba(255,255,255,.05)");v.addColorStop(1,"rgba(0,0,0,.35)");ctx.fillStyle=v;ctx.fillRect(0,0,w,h);
      noise(ctx,.18,seeded);
      var n=Math.round(w*h/650);
      for(var i=0;i<n;i++){
        var x=r()*w,y=r()*h,rad=1.2+Math.pow(r(),3)*10,ey=rad*(.85+r()*.3);
        ctx.fillStyle="rgba(28,0,9,.42)";ctx.beginPath();ctx.ellipse(x+rad*.22,y+rad*.34,rad,ey,0,0,6.283);ctx.fill();
        var b=ctx.createRadialGradient(x+rad*.25,y+rad*.3,0,x,y,rad);b.addColorStop(0,"rgba(200,70,105,.6)");b.addColorStop(.75,"rgba(110,18,48,.55)");b.addColorStop(1,"rgba(60,4,22,.7)");
        ctx.fillStyle=b;ctx.beginPath();ctx.ellipse(x,y,rad,ey,0,0,6.283);ctx.fill();
        if(rad>2.4){ctx.strokeStyle="rgba(255,175,195,.32)";ctx.lineWidth=rad*.14;ctx.beginPath();ctx.ellipse(x,y,rad*.78,ey*.78,0,.15,1.55);ctx.stroke()}
        ctx.fillStyle="rgba(255,240,244,"+(rad>2.4?.8:.55)+")";ctx.beginPath();ctx.ellipse(x-rad*.38,y-ey*.42,rad*.26,rad*.17,-.6,0,6.283);ctx.fill();
      }
    },
    gold:function(ctx,w,h,r){
      var g=ctx.createRadialGradient(w*.62,h*.38,0,w*.62,h*.38,Math.max(w,h)*.8);g.addColorStop(0,"#1e1a15");g.addColorStop(1,"#080809");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
      function rosette(cx,cy,R,a,k){ctx.strokeStyle="rgba(214,178,98,"+a+")";ctx.lineWidth=.7;for(var j=0;j<k;j++){ctx.save();ctx.translate(cx,cy);ctx.rotate(j*Math.PI/(k/2));ctx.beginPath();ctx.ellipse(0,0,R,R*.3,0,0,6.283);ctx.stroke();ctx.restore()}}
      rosette(w*.84,h*.2,w*.62,.11,96);rosette(w*.84,h*.2,w*.3,.16,64);rosette(w*.08,h*.98,w*.5,.08,80);
      for(var k=0;k<34;k++){ctx.beginPath();for(var x=0;x<=w;x+=6){var y=h*.72+k*3.2+Math.sin(x/42+k*.32)*9+Math.sin(x/130)*6;x?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.strokeStyle="rgba(214,178,98,"+(.035+.04*Math.sin(k/5))+")";ctx.lineWidth=.7;ctx.stroke()}
      for(var s=0;s<5;s++){var fx=r()*w,fy=r()*h,fl=ctx.createLinearGradient(fx,fy,fx+90,fy+30);fl.addColorStop(0,"rgba(240,200,110,0)");fl.addColorStop(.5,"rgba(240,200,110,.10)");fl.addColorStop(1,"rgba(240,200,110,0)");ctx.fillStyle=fl;ctx.fillRect(fx,fy,90,14)}
      noise(ctx,.22,seeded);
    },
    lava:function(ctx,w,h,r){
      var g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,"#ff9426");g.addColorStop(1,"#f06a0c");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);noise(ctx,.25,seeded);
      for(var L=0;L<5;L++){
        var y0=h*(.2+L*.13);ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(0,y0);
        for(var x=0;x<=w;x+=6){var y=y0+Math.sin(x*.012*(1+L*.35)+L*1.7)*h*.05+Math.sin(x*.04+L)*h*.018+(L===0?(r()-.5)*10:0);ctx.lineTo(x,y)}
        ctx.lineTo(w,h);ctx.closePath();var lg=ctx.createLinearGradient(0,y0-40,0,y0+120);lg.addColorStop(0,L?"#1a1a1a":"#111");lg.addColorStop(1,"#050505");ctx.fillStyle=lg;ctx.fill();
        ctx.strokeStyle="rgba(255,255,255,.08)";ctx.lineWidth=1.2;ctx.stroke();
      }
      for(var k=0;k<160;k++){var sx=r()*w,sy=h*.3+r()*h*.7,len=40+r()*160;ctx.strokeStyle="rgba(255,255,255,"+(.02+r()*.04)+")";ctx.lineWidth=.6+r()*2;ctx.beginPath();ctx.moveTo(sx,sy);ctx.quadraticCurveTo(sx+len*.5,sy-10+r()*20,sx+len,sy+(r()-.5)*16);ctx.stroke()}
      for(var d=0;d<420;d++){var dy=h*.22+r()*h*.78;ctx.fillStyle="rgba(255,"+(110+r()*40|0)+",0,"+(.5+r()*.5)+")";ctx.beginPath();ctx.arc(r()*w,dy,.5+Math.pow(r(),4)*4,0,6.283);ctx.fill()}
      for(var e=0;e<260;e++){ctx.fillStyle="rgba(10,10,10,.85)";ctx.beginPath();ctx.arc(r()*w,r()*h*.3,.4+Math.pow(r(),4)*3,0,6.283);ctx.fill()}
      var bx=w*.95,by=h*.95,R=Math.min(w,h)*.5,bl=ctx.createRadialGradient(bx-30,by-40,10,bx,by,R);bl.addColorStop(0,"#ffb35c");bl.addColorStop(.6,"#ff7a00");bl.addColorStop(1,"rgba(255,122,0,0)");ctx.fillStyle=bl;ctx.beginPath();ctx.arc(bx,by,R,0,6.283);ctx.fill();
    },
    indigo:function(ctx,w,h,r){
      var g=ctx.createRadialGradient(w*.5,-h*.1,0,w*.5,-h*.1,h*1.1);g.addColorStop(0,"#4630b8");g.addColorStop(.45,"#1b1456");g.addColorStop(1,"#080619");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
      for(var y=10;y<h;y+=13){for(var x=10;x<w;x+=13){var m=Math.sin(x*.02)+Math.sin(y*.02+x*.006)+Math.cos(x*.01-y*.01);if(m>.9){ctx.fillStyle="rgba(170,150,255,"+(.08+(m-.9)*.08)+")";ctx.beginPath();ctx.arc(x,y,1.1,0,6.283);ctx.fill()}}}
      var bx=w*.5,beam=ctx.createLinearGradient(bx-70,0,bx+70,0);beam.addColorStop(0,"rgba(150,180,255,0)");beam.addColorStop(.5,"rgba(170,190,255,.16)");beam.addColorStop(1,"rgba(150,180,255,0)");ctx.fillStyle=beam;ctx.fillRect(bx-70,0,140,h*.6);
      var gl=ctx.createRadialGradient(w*.5,h*.7,0,w*.5,h*.7,w*.8);gl.addColorStop(0,"rgba(110,80,255,.25)");gl.addColorStop(1,"rgba(110,80,255,0)");ctx.fillStyle=gl;ctx.fillRect(0,0,w,h);
      noise(ctx,.12,seeded);
    }
  };

  // Without Android (a browser on a computer) the page shows a demo, so it can be looked at.
  function demoPV(){
    var st={s:"off",since:0,ms:0,ip:"",loc:"",rd:0,ru:0,id:""},logs="";
    function tl(m){logs+=new Date().toTimeString().slice(0,8)+" "+m+"\n"}
    var DEMO={Title:"AliusVPN",Upload:2.1e9,Download:9.4e9,Total:1.074e11,Expire:Date.now()/1000+86400*23,Servers:[
      {name:"🇦🇹 Вена",country:"AT",proto:"VLESS · Reality",host:"a",port:1,kind:"link"},{name:"🇳🇱 Амстердам",country:"NL",proto:"VLESS · XHTTP",host:"b",port:1,kind:"link"},
      {name:"🇩🇪 Франкфурт",country:"DE",proto:"VLESS · Reality",host:"c",port:1,kind:"link"},{name:"🇫🇮 Хельсинки",country:"FI",proto:"Trojan",host:"d",port:1,kind:"link"},
      {name:"🇸🇪 Стокгольм",country:"SE",proto:"VLESS · gRPC",host:"e",port:1,kind:"link"},{name:"🇺🇸 Нью-Йорк",country:"US",proto:"Hysteria2",host:"f",port:1,kind:"link"},
      {name:"🇯🇵 Токио",country:"JP",proto:"VLESS · Reality",host:"g",port:1,kind:"link"}]};
    var model=null;
    return {version:function(){return "демо"},state:function(){if(st.s==="on"){st.rd=1.4e6+Math.random()*5e5;st.ru=1.6e5+Math.random()*6e4}return JSON.stringify(st)},
      connect:function(p){var s=JSON.parse(p).server;st.s="connecting";st.id=s.id;tl("подключаюсь: "+s.name);setTimeout(function(){st.s="on";st.since=Date.now();st.ip="185.103.110.12";st.loc=s.country;tl("подключено")},1300)},
      disconnect:function(){st.s="off";tl("отключено")},
      call:function(cmd,arg,id){setTimeout(function(){var r={};
        if(cmd==="sub")r=JSON.parse(JSON.stringify(DEMO));
        else if(cmd==="ping"||cmd==="rping"){var l=cmd==="ping"?JSON.parse(arg):JSON.parse(arg).servers;l.forEach(function(s,i){r[s.id]=[38,52,61,44,74,140,210][i%7]})}
        else r={Servers:[],Errors:["демо"]};
        pvCb(id,JSON.stringify(r))},500)},
      data:function(n){if(n==="stats.json"){var d=[],i,t=new Date();for(i=20;i>=0;i--){var x=new Date(t);x.setDate(t.getDate()-i);if(i%5!==3)d.push({day:x.toISOString().slice(0,10),down:(i+3)*2.1e8,up:(i+3)*3e7})}
        return JSON.stringify({days:d,servers:{a:{name:"🇦🇹 Вена",country:"AT",down:9e9,up:1e9,seconds:90000}},totalDown:2.1e10,totalUp:2.4e9,sessions:37,seconds:186400})}
        return st.s==="on"?JSON.stringify({sessDown:5.4e7,sessUp:6e6,sessSince:st.since/1000|0,speed:[],conns:[{host:"www.youtube.com",network:"tcp",route:"VPN",down:3.1e7,up:1e6},{host:"claude.ai",network:"tcp",route:"Напрямую",down:2e5,up:4e4}],connCount:2,updated:Date.now()/1000}):""},
      resetStats:function(){},log:function(){return logs},clearLogs:function(){logs=""},theme:function(){},vpnSettings:function(){},env:function(){},
      clipboard:function(){return ""},apps:function(){return JSON.stringify([{p:"com.google.android.youtube",l:"YouTube"},{p:"org.telegram.messenger",l:"Telegram"},{p:"com.android.chrome",l:"Chrome"}])},
      modelPart:function(i){if(model===null){try{var x=new XMLHttpRequest();x.open("GET","girls3d.json",false);x.send();model=x.status===200?x.responseText:""}catch(e){model=""}}
        var a=i*262144;return a>=model.length?"":model.slice(a,a+262144)}};
  }
  if(!window.PV&&location.hash==="#demo"&&!ls("pv2demo")){try{localStorage.setItem("pv2demo","1")}catch(e){}setTimeout(function(){pvAdd("https://example.com/sub")},300)}
})();
