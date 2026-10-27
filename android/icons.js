const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const svg=fs.readFileSync('fg.svg','utf8');
for(const [d,px] of [['mdpi',108],['hdpi',162],['xhdpi',216],['xxhdpi',324],['xxxhdpi',432]]){
 await p.setViewportSize({width:px,height:px});
 await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ','<svg width="'+px+'" height="'+px+'" ')}</body></html>`);
 fs.mkdirSync('res/mipmap-'+d,{recursive:true});
 await p.screenshot({path:'res/mipmap-'+d+'/ic_fg.png',omitBackground:true});
}
await p.setViewportSize({width:512,height:512});
await p.setContent(`<html><body style="margin:0;background:#0b0b0c">${svg.replace('<svg ','<svg width="512" height="512" ')}</body></html>`);
await p.screenshot({path:'icon_preview.png'});await b.close()})();
