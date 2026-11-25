(() => {
  "use strict";
  const api=globalThis.MaixuWatch;
  const initialRoom=api.roomId();
  if(!initialRoom || window!==window.top || document.getElementById("maixu-queue-panel"))return;
  let selected=null, stop=null, selecting=null, pending=false, runId=0;
  let stopReview=null;
  let others=[];
  const host=document.createElement("div");host.id="maixu-queue-panel";
  const shadow=host.attachShadow({mode:"open"});
  const css=new CSSStyleSheet();
  css.replaceSync(`:host{all:initial;position:fixed!important;top:68px!important;left:12px!important;z-index:2147483645!important;color-scheme:light}
    *{box-sizing:border-box}section{width:270px;max-width:96vw;padding:12px;border:1px solid #b9cdc9;border-radius:11px;background:#fcfffd;color:#183331;box-shadow:0 3px 14px #1233;font:14px/1.5 "Microsoft YaHei UI",sans-serif}
    header,.buttons{display:flex;align-items:center;gap:7px}header{justify-content:space-between}strong{font-size:16px}button{font:inherit;cursor:pointer;border:1px solid #9eb5af;border-radius:5px;background:#fff;color:#183331;padding:3px 8px}button:disabled{cursor:default;opacity:.5}button.primary{background:#116758;border-color:#116758;color:white}
    .small{font-size:12px}.product{margin:7px 0;overflow-wrap:anywhere}.status{margin:8px 0 0;padding:7px;background:#edf5f1;border-radius:4px;min-height:25px}label{display:block;margin:6px 0}input[type=text]{width:100%;font:inherit;padding:4px}.buttons{flex-wrap:wrap}details{margin-top:8px}summary{cursor:pointer}section.folded{width:auto}section.folded .body{display:none}button:focus-visible,summary:focus-visible{outline:2px solid #ae5e00}
  `);
  css.insertRule(".product{white-space:pre-line;max-height:120px;overflow:auto}",css.cssRules.length);
  css.insertRule("[hidden]{display:none!important}",css.cssRules.length);
  shadow.adoptedStyleSheets=[css];
  function build(tag,parent,text="",className=""){
    const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;
    parent.append(node);return node;
  }
  function button(parent,label,id,fn,cls=""){
    const b=build("button",parent,label,cls);b.type="button";b.id=id;b.addEventListener("click",fn);return b;
  }
  const section=build("section",shadow),head=build("header",section);
  build("strong",head,"麦序助手");
  const fold=button(head,"收起","fold",()=>{const f=section.classList.toggle("folded");fold.textContent=f?"展开":"收起";},"small");
  const body=build("div",section,"","body"),product=build("div",body,"","product"),controls=build("div",body,"","buttons");
  const pick=button(controls,"点选商品","pick",()=>selectProduct(false));
  const add=button(controls,"再选一款","add",()=>selectProduct(true));
  const dry=button(controls,"仅提醒","dry",()=>arm(true));
  const go=button(controls,"开始守候","go",()=>arm(false),"primary");
  const cancel=button(controls,"停止","stop",halt);
  const submitLabel=build("label",body),direct=build("input",submitLabel);
  direct.type="checkbox";direct.id="direct-submit";direct.checked=true;
  submitLabel.append(document.createTextNode(" 结算按钮出现就点一次"));
  direct.addEventListener("change",draw);
  const msg=build("div",body,"","status");msg.id="status";msg.setAttribute("role","status");
  const review=build("div",body,"","small");review.id="order-review";review.hidden=true;
  const settings=build("details",body);build("summary",settings,"目标和守候方式");
  const stockTest=button(settings,"现货测速（点一次商品）","stock-test",()=>arm(false,true));
  const timingOutput=build("div",settings,"","small");timingOutput.id="stock-timing";
  const waveLabel=build("label",settings);
  const twoWaves=build("input",waveLabel);twoWaves.type="checkbox";twoWaves.id="two-waves";
  const waveCaption=document.createTextNode(" 先看到同款被抢光，再抢下一波");waveLabel.append(waveCaption);
  const label=build("label",settings),appear=build("input",label);appear.type="checkbox";appear.id="appear";
  label.append(document.createTextNode(" 允许目标首次进入可见商品列表时触发"));
  twoWaves.addEventListener("change",()=>{if(twoWaves.checked)appear.checked=false;});
  appear.addEventListener("change",()=>{if(appear.checked)twoWaves.checked=false;});
  const nextLabel=build("label",settings),newGoods=build("input",nextLabel);newGoods.type="checkbox";newGoods.id="new-goods";
  nextLabel.append(document.createTextNode(" 同时守本场新上架的捏捏"));
  const limitLabel=build("label",settings,"新上架商品的标价上限（元）"),limit=build("input",limitLabel);
  limit.type="text";limit.id="new-limit";limit.inputMode="decimal";limit.value="50";limitLabel.hidden=true;
  newGoods.addEventListener("change",draw);
  const clearOthers=button(settings,"只保留第一款","clear-others",()=>{others=[];recordWave("reset");draw();});
  const tl=build("label",settings,"商品完整标题"),titleField=build("input",tl);titleField.type="text";titleField.id="title";
  const pl=build("label",settings,"价格（元）"),priceField=build("input",pl);priceField.type="text";priceField.inputMode="decimal";priceField.id="price";
  const save=button(settings,"使用此目标","save",()=>{
    const s=priceField.value.trim();
    if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(s)){say("请填写商品的准确价格，如 20 或 19.90。");return;}
    const [whole,frac=""]=s.split(".");setTarget({title:titleField.value.trim(),price:Number(whole)*100+Number(frac.padEnd(2,"0"))});
  });
  const proof=build("div",body,"","small");proof.id="wave-proof";proof.hidden=true;
  const labels={first:"首轮可买",sold:"首轮售罄",next:"下轮可买"};
  const times=new Map();
  function recordWave(event,at,title="",badge=""){
    if(event==="reset")times.clear();
    else times.set(event,{at,title,badge});
    proof.textContent=Array.from(times,([key,entry])=>{
      const time=new Date(entry.at).toTimeString().slice(0,8)+"."+String(entry.at%1000).padStart(3,"0");
      return labels[key]+" "+time+(entry.title?" "+entry.title:"");
    }).join(" · ");
    proof.dataset.timeline=JSON.stringify(Object.fromEntries(times));
    proof.hidden=!times.size;
  }
  function say(text){msg.textContent=text;}
  function draw(){
    product.textContent=selected?[selected,...others].map(t=>t.title+"　¥"+(t.price/100).toFixed(2)).join("\n"):"请先在「全部商品」中点选目标。";
    waveCaption.textContent=others.length||newGoods.checked?" 先看到一款被抢光，再抢下一批":" 先看到同款被抢光，再抢下一波";
    clearOthers.hidden=!others.length;limitLabel.hidden=!newGoods.checked;
    const active=!!stop||pending;
    direct.disabled=active;
    go.textContent=direct.checked?"开始守候并提交":"开始守候";
    stockTest.textContent=direct.checked?"现货测速并提交":"现货测速（点一次商品）";
    for(const el of [pick,twoWaves,appear,newGoods,limit,clearOthers,titleField,priceField,save])el.disabled=active;
    add.disabled=active||!selected;
    dry.disabled=go.disabled=active||!selected;
    stockTest.disabled=active||!selected||others.length>0;
    cancel.disabled=!active&&!selecting;
  }
  function setTarget(data,append=false){
    if(!data?.title||data.title.length<3||!Number.isSafeInteger(data.price)||data.price<=0){say("无法确认标题或准确价格，请换一个商品位置。");return false;}
    if(/【补】|\[补\]|补款|补差|邮费|运费|专拍|【留言】|\[留言\]/.test(data.title)){say("这是补款、留言或专拍条目，请选麦序商品。");return false;}
    const entry={title:data.title,price:data.price,room:api.roomId()};
    if(append&&selected){
      if([selected,...others].some(t=>t.title===entry.title)){
        say("清单里已经有这个标题。需要换价时请重新点选。");return true;
      }
      others.push(entry);
    }else{selected=entry;others=[];}
    recordWave("reset");
    titleField.value=entry.title;priceField.value=(entry.price/100).toFixed(2);
    say(others.length?"已加入同时守候清单，共 "+(others.length+1)+" 款。":"已选定目标。保持商品面板打开，点「开始守候」或「仅提醒」。");draw();return true;
  }
  function clearPick(){if(selecting){selecting.abort();selecting=null;}}
  function halt(){
    runId++;clearPick();const end=stop||stopReview;stop=null;stopReview=null;pending=false;
    if(end)end();
    say("已停止。");
    draw();
  }
  function showOrder(result,message){
    review.dataset.result=JSON.stringify(result);
    if(message){say(message);return;}
    const labels={pending:"待付款",paid:"已付款",closed:"交易关闭"};
    const fields=[labels[result.state],result.title,result.spec,result.quantity&&"数量 "+result.quantity,result.amount&&"¥"+result.amount].filter(Boolean);
    review.textContent=fields.join(" · ");review.hidden=false;
    say("订单页显示「"+labels[result.state]+"」。");
  }
  function selectProduct(append){
    clearPick();selecting=new AbortController();
    for(const doc of api.documents()){
      function capture(e){
        if(e.composedPath().includes(host))return;
        if(e.type==="keydown"){if(e.key==="Escape"){e.preventDefault();halt();}return;}
        const path=e.composedPath(), hit=path[0];
        if(!hit?.closest)return;
        e.preventDefault();e.stopImmediatePropagation();
        if(e.type!=="click")return;
        const item=api.describe(api.cardOf(hit));
        if(!item){say("请点商品行里的标题或缩略图，或按 Esc 取消。");return;}
        if(setTarget(item,append)){clearPick();draw();}
      }
      for(const type of ["pointerdown","pointerup","mousedown","mouseup","click","keydown"]){
        doc.defaultView.addEventListener(type,capture,{capture:true,signal:selecting.signal});
      }
    }
    say("现在点目标行的标题或图片。此次选择只记录商品，Esc 可取消。");draw();
  }
  async function arm(rehearsal,stock=false){
    if(stop||pending||!selected)return;
    if(stock&&others.length)return;
    stopReview?.();stopReview=null;review.hidden=true;delete review.dataset.result;
    const now=()=>performance.timeOrigin+performance.now();
    const timing=stock?{command:now()}:null;
    if(stock){timingOutput.textContent="正在核对现货入口。";timingOutput.dataset.events=JSON.stringify(timing);}
    clearPick();
    if(api.roomId()!==selected.room){selected=null;others=[];draw();say("直播间已改变，请重新点选目标。");return;}
    const amount=limit.value.trim();
    if(newGoods.checked&&(!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount)||Number(amount)<=0)){
      say("请填写新上架商品的标价上限，例如 50。");return;
    }
    if(!navigator.locks){say("浏览器不支持本地互斥锁，请使用新版 Chrome 或 Edge。");return;}
    const id=++runId;pending=true;draw();
    recordWave("reset");
    try{
      await navigator.locks.request("maixu-single-watch-v1",{ifAvailable:true},async lock=>{
        if(id!==runId)return;
        if(!lock){pending=false;say("另一个标签页正在守候，请先在那一页停止。");draw();return;}
        let release;
        const finished=new Promise(resolve=>{release=resolve;});
        function finish(){
          if(id===runId){stop=null;pending=false;draw();}
          release();
        }
        const multi=!stock&&(others.length>0||newGoods.checked);
        const start=multi?api.startBatch:api.start;
        const end=start({...selected,targets:[selected,...others],newGoods:newGoods.checked,cap:Math.round(Number(amount)*100),
          dry:rehearsal,stockTest:stock,appearance:!stock&&appear.checked,twoWaves:!stock&&twoWaves.checked,onWave:recordWave,
          onDetected:stock?()=>{timing.detected=now();}:undefined,
          onDispatch:stock?()=>{timing.dispatch=now();timingOutput.dataset.events=JSON.stringify(timing);
            timingOutput.textContent="指令到入口点击 "+(timing.dispatch-timing.command).toFixed(1)+" 毫秒。";}:undefined},say,entry=>{
          if(!entry||rehearsal||!direct.checked||id!==runId){finish();return;}
          pending=false;
          stop=stopReview=globalThis.MaixuCheckout.follow(entry,(result,message)=>{
            if(id!==runId)return;
            if(timing && result.receivedAt){
              timing.checkoutClick=result.receivedAt;
              if(result.observedAt && !timing.receipt)timing.receipt=result.observedAt;
              timingOutput.dataset.events=JSON.stringify(timing);
              const elapsed=event=>(timing[event]-timing.command).toFixed(1)+" 毫秒";
              timingOutput.textContent="从指令起，入口点击 "+elapsed("dispatch")+"，结算点击 "+elapsed("checkoutClick")+
                (timing.receipt?"，订单回执 "+elapsed("receipt"):"")+"。";
            }
            showOrder(result,message);
          },finish);
          draw();
          return stopReview;
        });
        if(id===runId && pending){stop=end;pending=false;draw();}
        await finished;
      });
    }catch{if(id===runId){stop=null;pending=false;say("监听启动失败，请重新展开商品列表后再试。");draw();}}
  }
  say("先展开「全部商品」，点选目标后开始守候。");
  draw();document.documentElement.append(host);
})();
