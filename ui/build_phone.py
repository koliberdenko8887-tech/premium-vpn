#!/usr/bin/env python3
"""Builds the phone screen android/assets/app.html from the Windows page ui/desktop.html.

The Windows page stays as it is; this script swaps what only a computer has (system proxy,
TUN engines, ports, Happ import), renames «Банда» to «Друзья», adds four more themes and puts
in phone/phone.css, phone/phone.js (the pvXxx functions over Android's bridge) and phone/sect.js
(the settings). Fonts, flags, the icon and three.js are inlined so the app works offline.
"""
import base64, os, re, shutil

UI = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(UI)
OUT = os.path.join(ROOT, "android", "assets")


def read(*p):
    return open(os.path.join(UI, *p), encoding="utf-8").read()


s = read("desktop.html")


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"{n}× {old[:70]!r}"
    s = s.replace(old, new)


# ---- page frame ----
rep('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">')
rep("</style>\n</head>", read("phone", "phone.css") + "\n</style>\n</head>")
rep("<script>\n(function(){\n  var C={", "<script>\n" + read("phone", "phone.js") + "\n</script>\n<script>\n(function(){\n  var C={")

# ---- «Банда» → «Друзья» ----
rep('aria-label="Банда"', 'aria-label="Друзья"')
rep('<span class="tip">Банда</span>', '<span class="tip">Друзья</span>')
rep('<span class="tip">Мой герой</span>', '<span class="tip">Герой</span>')
rep("Моя <em>банда</em>", "Мои <em>друзья</em>")
rep("Так будет выглядеть банда. Друзья, очки и награды", "Так будут выглядеть ваши друзья. Очки и награды")
rep("кристаллов банды", "общих кристаллов")
rep("Награда: сундук банды", "Награда: общий сундук")
rep("Бонусы банды", "Бонусы друзей")
rep("3 друга в банде", "3 друга с вами")
rep("Серия банды 7 дней", "Общая серия 7 дней")
rep("<span>Сундук банды</span>", "<span>Общий сундук</span>")

# ---- texts written for a computer ----
rep("Бесплатный сервер встроен; свои серверы добавляются в «Подписках».", "Серверы добавляются в «Подписках»: вставьте ссылку на подписку.")
rep(" Если на компьютере есть Happ, кнопка «Взять из Happ» сама перенесёт его подписки.", "")
rep("<h1>Журнал и <em>проверка</em></h1>", "<h1>Жур<em>нал</em></h1>")
rep('var LOGS=[["connect","Подключение"],["core","sing-box"],["xray","Xray"],["xraytun","Xray TUN"],["tun2proxy","tun2proxy"],["masque","WARP MASQUE"],["diag","Отчёт проверки"]];',
    'var LOGS=[["core","Журнал"]];')
rep('var logName="connect"', 'var logName="core"')
rep('$("subbar").innerHTML=sub?("<span>Подписка <b>"+esc(sub.title||"")+"</b></span>"+(sub.expire?"<span>до "+fmtDate(sub.expire).slice(0,5)+"</span>":"")):("<span>Бесплатный сервер <b>WARP</b></span>"+(S.settings.autoReconnect?"<span>авто ✓</span>":""));',
    '$("subbar").innerHTML=sub?("<span>Подписка <b>"+esc(sub.title||"")+"</b></span>"+(sub.expire?"<span>до "+fmtDate(sub.expire).slice(0,5)+"</span>":"")):("<span>Свои серверы</span>"+(S.settings.autoReconnect?"<span>авто ✓</span>":""));')
rep('if(S.servers.length<2){', 'if(S.servers.length<2||S.servers[0].kind==="none"){')
rep('n+" спит. Нажмите на героя, чтобы включить VPN"', '(sel.kind==="none"?n+" ждёт сервер. Добавьте подписку в разделе «Ещё» → «Подписки»":n+" спит. Нажмите на героя, чтобы включить VPN")')
rep('if(vis&&!busy&&!(S.diag&&S.diag.running)&&c.status!=="error"){var n=heroName(g.me);',
    'if(vis&&!busy&&!(S.diag&&S.diag.running)&&c.status!=="error"){var n=heroName(g.me),sel=S.servers.find(function(x){return x.id===S.selected})||S.servers[0];')

# ---- phone behaviour ----
rep('$("chg").addEventListener("click",function(){show("servers")});', '$("chg").addEventListener("click",function(){if(window.pvSheet)pvSheet();else show("servers")});')
rep("""$("pasteBtn").addEventListener("click",function(){if(navigator.clipboard&&navigator.clipboard.readText)navigator.clipboard.readText().then(function(t){$("addText").value=t}).catch(function(){toast("Нажмите в поле и Ctrl+V")});else toast("Нажмите в поле и Ctrl+V")});""",
    """$("pasteBtn").addEventListener("click",function(){var t=window.PV&&PV.clipboard?PV.clipboard():"";if(t)$("addText").value=t;else toast("Буфер обмена пуст: скопируйте ссылку и нажмите ещё раз")});""")
rep("try{document.execCommand(\"copy\");toast(\"Скопировано\")}catch(e){toast(\"Текст выделен: нажмите Ctrl+C\")}}", "try{document.execCommand(\"copy\");toast(\"Скопировано\")}catch(e){toast(\"Текст выделен: нажмите «Копировать»\")}}")
rep("resetSettings:window.pvResetSettings,resetNetwork:window.pvResetNetwork,theme:window.pvTheme",
    "resetSettings:window.pvResetSettings,resetNetwork:window.pvResetNetwork,theme:window.pvTheme,vpnSettings:window.pvVpnSettings")
rep("""(f.ty==="theme"?[["Красный туз",function(){applyTheme("ace")},"theme-b","ace"],["Океан и пламя",function(){applyTheme("ocean")},"theme-b","ocean"]]:f.b)""",
    """(f.ty==="theme"?PV_THEMES.map(function(x){return [x[1],function(){applyTheme(x[0])},"theme-b",x[0]]}):f.b)""")
rep('if(t!=="ocean")t="ace";', 'if(!PV_THEMES.some(function(x){return x[0]===t}))t="ace";')
rep('if(document.documentElement.dataset.theme==="ocean")paintOcean(w,h);else paintCards(w,h);',
    'var th=document.documentElement.dataset.theme;if(PV_PAINT[th])PV_PAINT[th](ctx,w,h,rng(11));else if(th==="ocean")paintOcean(w,h);else paintCards(w,h);')

# ---- settings for the phone ----
a = s.index("  // ---- Settings: every option of Happ, grouped by section ----")
b = s.index('  var sect="conn",built="",fields=[];')
s = s[:a] + read("phone", "sect.js") + s[b:]

# ---- fonts, flags, icon, three.js ----
FACES = [("Unbounded", "unbounded", [600]), ("Manrope", "manrope", [400, 600, 700, 800]), ("Playfair Display", "playfair-display", [700, 800]),
         ("Cormorant Garamond", "cormorant-garamond", [700]), ("Forum", "forum", [400]), ("Oswald", "oswald", [700])]
RANGES = [("cyrillic", "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"),
          ("latin", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD")]
css = []
for fam, name, weights in FACES:
    for w in weights:
        for sub, rng in RANGES:
            b64 = base64.b64encode(open(os.path.join(UI, "fonts", f"{name}-{sub}-{w}-normal.woff2"), "rb").read()).decode()
            css.append(f"@font-face{{font-family:'{fam}';font-weight:{w};font-display:swap;src:url(data:font/woff2;base64,{b64}) format('woff2');unicode-range:{rng}}}")
rep("/*FONTS*/", "\n".join(css))

SIMPLE = {  # flags whose coat of arms is invisible at 26 px: plain stripes instead
    "es": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><path fill="#aa151b" d="M0 0h640v480H0z"/><path fill="#f1bf00" d="M0 120h640v240H0z"/></svg>',
    "rs": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><path fill="#c6363c" d="M0 0h640v160H0z"/><path fill="#0c4076" d="M0 160h640v160H0z"/><path fill="#fff" d="M0 320h640v160H0z"/></svg>',
}
flags = []
for c in sorted(set(re.findall(r'\b([A-Z]{2}):\["', s)) - {"AUTO"}):
    svg = SIMPLE.get(c.lower()) or read("flags", c.lower() + ".svg")
    svg = re.sub(r">\s+<", "><", svg.strip())
    flags.append(f'{c}:"data:image/svg+xml;base64,{base64.b64encode(svg.encode()).decode()}"')
rep("/*FLAGS*/", "var FLAGS={" + ",".join(flags) + "};")
icon = re.sub(r">\s+<", "><", read("icon.svg").strip())
rep("/*ICON*/", "data:image/svg+xml;base64," + base64.b64encode(icon.encode()).decode())
js = "\n".join(read("vendor", f) for f in ["three.min.js", "room.js", "hero3d.js"])
assert "</script" not in js
rep("/*THREE3D*/", js)

os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "app.html"), "w", encoding="utf-8").write(s)
shutil.copyfile(os.path.join(UI, "vendor", "girls3d.json.gz"), os.path.join(OUT, "girls3d.json.gz"))
print("app.html", len(s.encode()) // 1024, "KB")
