(() => {
  "use strict";
  const entryLabels = new Set(["去抢购", "去抢拍", "立即抢购", "去购买", "去抢"]);
  const upcoming = /距(?:离)?(?:开抢|开售|开卖|开始)(?:还有)?\s*(?:\d|[:：])|开抢倒计时|待开抢|未开售|即将(?:开抢|开售|开卖|上架)|等待开抢|开抢提醒|提醒我|\d{1,2}:\d{2}(?::\d{2})?\s*(?:开抢|开售|开秒)/;
  const soldWords = /已抢光|已售罄|已售完|已抢完|已下架|暂时缺货|暂无库存|找同款/;
  const closed = text => soldWords.test(text) || upcoming.test(text);
  const soldOut = /已抢光|已售罄|已售完|已抢完/;
  const handoffWords = /提交订单|确认支付|免密支付|支付\s*[¥￥]|填写收货地址|请先填写地址|扫描二维码.{0,8}购买|先用后付.{0,4}下单/;
  const actionQuery = 'button,[role="button"]';
  const titleQuery = '[data-e2e="promotion-title"],[data-e2e="product-title"],[data-e2e="goods-title"]';
  const rowQuery = 'li,[role="listitem"]';
  const listQuery = 'ul,ol,[role="list"]';
  const keyOf = text => String(text || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const roomId = () => {
    return location.origin === "https://live.douyin.com" ? location.pathname.match(/^\/(\d+)\/?$/)?.[1] || "" : "";
  };

  function displayed(el) {
    if (!el?.isConnected) return false;
    const rect = el.getBoundingClientRect(), win = el.ownerDocument.defaultView;
    if (!win || rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
        rect.left >= win.innerWidth || rect.top >= win.innerHeight) return false;
    const style = win.getComputedStyle(el);
    return style.visibility === "visible" && style.display !== "none" && Number(style.opacity) > 0;
  }

  function atHitPoint(button) {
    if (!displayed(button)) return false;
    let doc = button.ownerDocument;
    const rect = button.getBoundingClientRect();
    let x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    let hit = doc.elementFromPoint(x, y);
    if (!hit || !(hit === button || button.contains(hit))) return false;
    while (doc !== document) {
      const frame = doc.defaultView?.frameElement;
      if (!frame || !displayed(frame)) return false;
      const bounds = frame.getBoundingClientRect();
      x = bounds.left + (frame.clientLeft + x) * bounds.width / frame.offsetWidth;
      y = bounds.top + (frame.clientTop + y) * bounds.height / frame.offsetHeight;
      doc = frame.ownerDocument;
      if (doc.elementFromPoint(x, y) !== frame) return false;
    }
    return true;
  }

  function documents() {
    const docs = [document];
    for (const doc of docs) {
      for (const frame of doc.querySelectorAll("iframe")) {
        try {
          const nested = frame.contentDocument;
          if (nested?.documentElement && displayed(frame) && !docs.includes(nested)) docs.push(nested);
        } catch { /* 跨域区域由浏览器隔离。 */ }
      }
    }
    return docs;
  }

  function productButtons(row, visible=displayed) {
    const labeled=row.querySelectorAll('[data-e2e="shop-buyBtn"]');
    return [...(labeled.length?labeled:row.querySelectorAll(actionQuery))].filter(b => entryLabels.has(keyOf(b.textContent)) && visible(b));
  }

  function titleOf(row) {
    const values = [...row.querySelectorAll("img[alt]")].map(img => img.alt.trim()).filter(Boolean);
    const titles = [...new Set(values.filter(v => v.length >= 3))];
    const explicit=[...new Set([...row.querySelectorAll(titleQuery)].map(n=>n.textContent.trim()).filter(Boolean))];
    if(explicit.length) return explicit.length===1 && (!titles.length || titles.some(t=>keyOf(t)===keyOf(explicit[0]))) ? explicit[0] : "";
    return titles.length===1 ? titles[0] : "";
  }

  function priceOf(text) {
    const normalized=String(text).normalize("NFKC");
    const tokens=[...normalized.matchAll(/[¥￥]\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.])/g)];
    if (!tokens.length || /[¥￥]\s*[\d,.]+\s*(?:起|[-~～至]\s*[¥￥]?\s*\d)/.test(normalized)) return null;
    const values=tokens.map(match=>{
      const [whole,part=""]=match[1].replaceAll(",","").split(".");
      return Number(whole)*100+Number(part.padEnd(2,"0"));
    });
    return values.every(v=>v===values[0]) && Number.isSafeInteger(values[0]) && values[0]>0 ? values[0] : null;
  }
  function rowPrice(row, visible=displayed) {
    const fields=row.querySelectorAll('[data-e2e="price-Area"]');
    if(!fields.length)return priceOf(row.innerText);
    const values=[...fields].filter(visible).map(field=>priceOf(field.innerText));
    return values.length && values.every(value=>value===values[0]) ? values[0] : null;
  }

  function cardOf(el) {
    if (!el?.closest) return null;
    const item=el.closest(rowQuery);
    if (item && titleOf(item) && rowPrice(item) !== null) return item;
    // 部分讲解弹卡没有 listitem，限定到只含一件商品的小容器。
    for (let node=el.parentElement, depth=0; node && depth<7; node=node.parentElement, depth++) {
      if (node.matches("body,html") || node.querySelectorAll(rowQuery).length>1) break;
      if (node.querySelectorAll("img[alt]").length===1 && titleOf(node) &&
          rowPrice(node)!==null && productButtons(node).length===1) return node;
    }
    return null;
  }

  function disabled(button, row) {
    if (button.matches(":disabled") || button.closest('[inert],[aria-disabled="true"]')) return true;
    for (let el=button; el && el!==row.parentElement; el=el.parentElement) {
      if (el.ownerDocument.defaultView.getComputedStyle(el).pointerEvents==="none") return true;
    }
    return false;
  }

  function skin(button, row) {
    const paint=button.ownerDocument.defaultView.getComputedStyle(button);
    let alpha=1;
    for (let el=button; el && el!==row.parentElement; el=el.parentElement) {
      alpha*=Number(el.ownerDocument.defaultView.getComputedStyle(el).opacity);
    }
    return [keyOf(button.textContent),paint.backgroundColor,paint.backgroundImage,paint.color,alpha.toFixed(3)].join("|");
  }

  function safePanel(row) {
    const modal=row.closest('dialog,[role="dialog"],[aria-modal="true"]');
    return !handoffWords.test(row.innerText) && (!modal || !handoffWords.test(modal.innerText));
  }

  function describe(row) {
    if (!row || !displayed(row) || !safePanel(row)) return null;
    const title=titleOf(row), price=rowPrice(row);
    return title && price!==null ? {title,price} : null;
  }

  function start(config, notify, ended) {
    const room=roomId(), target=keyOf(config.title), roots=new Set(), docsSeen=new Map();
    const observers=new Map(), known=new Set(), activeSkins=new Set(), soldSkins=new Set();
    let live=true, syncRunning=false, baseline=!!config.stockTest, previouslyDisabled=false, timer, lastState="", preferredList=null;
    let waveRoot=null, firstSaleSkin="", sawSellout=false, scheduledButtonExpected=false;
    const events=new AbortController();
    function status(msg) { if(msg!==lastState){lastState=msg;notify(msg);} }
    function resetWaves() {
      if(!config.twoWaves)return;
      if(firstSaleSkin)config.onWave?.("reset");
      waveRoot=null;firstSaleSkin="";sawSellout=false;
      baseline=false;previouslyDisabled=false;soldSkins.clear();
    }
    function stop(msg, entry) {
      if(!live)return;
      live=false;
      clearInterval(timer);
      events.abort();
      for(const obs of [...observers.values(),...docsSeen.values()])obs.disconnect();
      observers.clear();docsSeen.clear();roots.clear();known.clear();
      if(msg)status(msg);
      return ended(entry);
    }
    function isTarget(row) { return keyOf(titleOf(row))===target; }
    function clickOrRehearse(row,button) {
      if(!live||roomId()!==room||document.hidden||!document.hasFocus())return stop("窗口失去焦点或房间变化，本轮已停。");
      // 同一次 JS 调用栈做最后复核，先锁定本轮，再派发商品入口点击。
      if(!row.isConnected || !row.contains(button) || keyOf(titleOf(row))!==target ||
         rowPrice(row)!==config.price || !safePanel(row) || closed(row.innerText.replace(titleOf(row),"")) ||
         disabled(button,row) || !entryLabels.has(keyOf(button.textContent)) || !atHitPoint(button)){
        status("最后复核未通过，继续等目标恢复可操作。");return;
      }
      const at=config.twoWaves?Date.now():0;
      config.onDetected?.();
      if(config.dry){stop("目标已可买，本轮提醒结束。");if(at)config.onWave?.("next",at);return;}
      const cancelCheckout=stop("已发出 1 次商品入口点击。",{title:config.title,doc:button.ownerDocument});
      config.onDispatch?.();
      try { button.click(); } catch { cancelCheckout?.();status("已尝试打开商品，结果未知。请查看页面，本轮已停。"); }
      if(at)config.onWave?.("next",at);
    }
    function examine() {
      if(!live)return;
      if(roomId()!==room||document.hidden)return stop("已离开当前直播间，本轮已停。");
      let matches=[...known].filter(row=>row.isConnected&&displayed(row)&&isTarget(row));
      if(!config.twoWaves && matches.length>1 && preferredList?.isConnected){
        const originals=matches.filter(row=>row.closest(listQuery)===preferredList);
        if(originals.length===1)matches=originals;
      }
      if(matches.length!==1){resetWaves();status(matches.length?"发现两个同名目标，等待页面只显示一个。":"等待目标商品出现在已打开的商品列表或弹卡。");return;}
      const row=matches[0], text=row.innerText.replace(titleOf(row),"");
      if(config.twoWaves){
        const root=row.closest(listQuery)||row;
        if(waveRoot&&waveRoot!==root)resetWaves();
        waveRoot=root;
      }
      if(!preferredList?.isConnected)preferredList=row.closest(listQuery);
      if(!safePanel(row))return stop("已到订单或支付相关页面，请本人接手。");
      if(rowPrice(row)!==config.price){resetWaves();status("同名商品的价格未匹配，等待。");return;}
      const buttons=productButtons(row);
      if(closed(text) || (buttons.length===1&&disabled(buttons[0],row))){
        scheduledButtonExpected=upcoming.test(text)&&buttons.length===0;
        if(config.twoWaves){
          if(closed(text)&&!soldOut.test(text)){
            resetWaves();status("等待首轮可买，商品目前尚未开售或已下架。");return;
          }
          if(soldOut.test(text)&&firstSaleSkin&&!sawSellout){
            sawSellout=true;config.onWave?.("sold",Date.now());
          }
        }
        baseline=!config.twoWaves||sawSellout;
        // 先后更新蒙层和按钮时，保留曾经见过的可区分售罄样式。
        if(buttons.length===1){
          if(disabled(buttons[0],row))previouslyDisabled=true;
          const value=skin(buttons[0],row);
          if(!soldSkins.size || !activeSkins.has(value))soldSkins.add(value);
        }
        if(config.twoWaves&&!sawSellout){
          status(firstSaleSkin?"已见首轮可买，等待同款明确显示已抢光。":"等待首轮可买，进场时的售罄不计入。");return;
        }
        status(upcoming.test(text)?"已看到待开抢标记，正在等购买按钮开放。":"已认出目标售罄，正在等它可抢。");return;
      }
      if(!baseline&&!config.twoWaves){status("目标启动时已在场，等待下一轮售罄后补货。");return;}
      if(buttons.length!==1){status("等待目标行出现唯一的商品入口。");return;}
      const button=buttons[0], value=skin(button,row);
      const explicitAvailable=/可抢购|有货|立即开抢|现可抢购/.test(text.replace(button.innerText,""));
      // 仅一行时可用实测过的抖音购物袋按钮样式，须先见过同一目标的另一种售罄样式。
      const standardButton=button.matches('button[data-e2e="shop-buyBtn"]') && (soldSkins.size>0||scheduledButtonExpected||config.twoWaves||config.stockTest) &&
        value===[keyOf(button.textContent),"rgb(254, 44, 85)","none","rgb(255, 255, 255)","1.000"].join("|");
      const looksAvailable=(config.twoWaves&&firstSaleSkin===value)||((activeSkins.has(value)||standardButton)&&!soldSkins.has(value));
      if((config.twoWaves||!previouslyDisabled) && !explicitAvailable && !looksAvailable){
        status("目标状态尚未确认，正在等可售按钮样式。");return;
      }
      if(!atHitPoint(button)){status("入口被遮挡或在屏幕外，请露出目标按钮。");return;}
      if(config.twoWaves&&!sawSellout){
        if(!firstSaleSkin){firstSaleSkin=value;config.onWave?.("first",Date.now());}
        status("已见首轮可买，等待同款明确显示已抢光。");return;
      }
      clickOrRehearse(row,button);
    }
    function addPeer(row) {
      if(!displayed(row)||isTarget(row)||!safePanel(row)||closed(row.innerText.replace(titleOf(row),""))||!describe(row))return;
      const buttons=productButtons(row);
      if(buttons.length===1 && !disabled(buttons[0],row))activeSkins.add(skin(buttons[0],row));
    }
    function insideKnown(node) {
      const el=node.nodeType===1?node:node.parentElement;
      for(const row of known)if(el && (row===el||row.contains(el)))return true;
      return false;
    }
    function structural(node){
      return node.nodeType===1 && (node.matches(rowQuery+',iframe,img[alt]') || !!node.querySelector(rowQuery+',iframe,img[alt]'));
    }
    function addedProductOrFrame(node) {
      if(node.nodeType!==1)return false;
      if(node.matches("iframe")||node.querySelector("iframe"))return true;
      if(node.matches("img[alt]")&&keyOf(node.alt)===target)return true;
      const images=node.querySelectorAll("img[alt]");
      if(!images.length)return false;
      if([...images].some(img=>keyOf(img.alt)===target))return true;
      return [...node.querySelectorAll(actionQuery)].some(b=>entryLabels.has(keyOf(b.textContent)));
    }
    function bindRoot(root) {
      if(roots.has(root))return;
      roots.add(root);
      const ob=new MutationObserver(records=>{
        if(!live)return;
        if([...known].some(row=>!row.isConnected) || records.some(r=>
          (r.type==="attributes" && ["alt","title"].includes(r.attributeName)) ||
          (r.type==="childList" && [...r.addedNodes,...r.removedNodes].some(structural)))){
          rescan();return;
        }
        if(records.some(r=>insideKnown(r.target))){examine();return;}
        if(!known.size || !activeSkins.size)rescan();
      });
      ob.observe(root,{subtree:true,childList:true,characterData:true,attributes:true});
      observers.set(root,ob);
    }
    function bindDoc(doc) {
      if(docsSeen.has(doc))return;
      const ob=new MutationObserver(records=>{
        if(!live)return;
        if([...roots].some(root=>!root.isConnected)) { rescan();return; }
        for(const rec of records) {
          if([...roots].some(r=>r.contains(rec.target)))continue;
          if([...rec.addedNodes].some(addedProductOrFrame)) {rescan();return;}
        }
      });
      ob.observe(doc.documentElement,{subtree:true,childList:true});
      docsSeen.set(doc,ob);
      doc.addEventListener("load",e=>{if(e.target?.tagName==="IFRAME")rescan();},{capture:true,signal:events.signal});
      for(const name of ["transitionend","animationend"]){
        doc.addEventListener(name,e=>{if(insideKnown(e.target))examine();},{capture:true,signal:events.signal});
      }
    }
    function rescan() {
      if(!live||syncRunning)return;
      syncRunning=true;
      try{
        const docs=documents(), currentDocs=new Set(docs), desired=new Set(), candidates=new Set();
        for(const [doc,obs] of docsSeen)if(!currentDocs.has(doc)){obs.disconnect();docsSeen.delete(doc);}
        for(const doc of docs){
          bindDoc(doc);
          for(const img of doc.querySelectorAll('img[alt]')){
            if(!displayed(img))continue;
            const r=img.closest(rowQuery);
            if(r && r.querySelector(actionQuery) && (isTarget(r)||entryLabels.has(keyOf(r.querySelector(actionQuery)?.textContent)))){
              const list=r.closest(listQuery)||r.parentElement;
              desired.add(list);
              if(isTarget(r))candidates.add(r);else if(activeSkins.size<8)addPeer(r);
            }else if(keyOf(img.alt)===target){
              const card=cardOf(img);
              if(card){desired.add(card.closest(listQuery)||card);candidates.add(card);}
            }
          }
          // 当标题由无障碍商品标题节点提供时也可识别。
          for(const title of doc.querySelectorAll(titleQuery)){
            if(keyOf(title.textContent)!==target||!displayed(title))continue;
            const row=cardOf(title);if(row){desired.add(row.closest(listQuery)||row);candidates.add(row);}
          }
        }
        for(const root of roots)if(!desired.has(root)){observers.get(root)?.disconnect();observers.delete(root);roots.delete(root);}
        for(const root of desired)bindRoot(root);
        known.clear();for(const row of candidates)known.add(row);
        if(config.appearance && !config.twoWaves && !known.size && desired.size)baseline=true;
        examine();
      } finally{syncRunning=false;}
    }
    document.addEventListener("visibilitychange",()=>{if(document.hidden)stop("标签页已切到后台，本轮已停。");},{signal:events.signal});
    window.addEventListener("pagehide",()=>stop("已离开直播页。"),{signal:events.signal});
    window.addEventListener("popstate",()=>{if(roomId()!==room)stop("直播间已切换。");},{signal:events.signal});
    // 只读本地画面的兜底，主路径由目标行的 DOM 通知直接驱动。
    let fallbackTicks=0;
    timer=setInterval(()=>{
      fallbackTicks++;
      if(!known.size || ![...known].some(displayed) || fallbackTicks%5===0)rescan();
      else examine();
    },1000);
    rescan();
    return stop;
  }
  function startBatch(config, notify, ended) {
    const room=roomId(), picks=new Map(config.targets.map(t=>[keyOf(t.title),t.price]));
    const seen=new Map(), offeredSkins=new Set(), docs=new Map(), arrivals=new Map();
    const beforeReopen=new Map();
    let lastScan=0,reopenUntil=0;
    let previousNames=new Set();
    const explicitOpen=/可抢购|有货|立即开抢|现可抢购/;
    const toy=/捏捏|捏乐|手作球|手作气球袋|DIY\s*手作袋|脆皮.{0,8}手工玩具/i;
    const extra=/补差|补款|尾款|订金|定金|运费|邮费|赠品|勿拍|专拍|禁单拍|禁单独拍|随单|团单专属|教程|会员|随机抽奖|球皮|空袋|替换袋|包装袋|收纳袋|帆布袋|手提袋|购物袋|材料包|工具包/;
    let list=null,listObserver=null,initial=true,firstSale=null,running=true,last="",timer,lastLength=0,completeShelf=false;
    const listeners=new AbortController();
    function say(value){if(value!==last){last=value;notify(value);}}
    function rendered(el){
      if(!el?.isConnected||!el.getClientRects().length)return false;
      const css=el.ownerDocument.defaultView.getComputedStyle(el);
      return css.visibility==="visible"&&css.display!=="none"&&Number(css.opacity)>0;
    }
    function stop(message,entry){
      if(!running)return;
      running=false;clearInterval(timer);listeners.abort();listObserver?.disconnect();
      for(const ob of docs.values())ob.disconnect();
      if(message)say(message);
      return ended(entry);
    }
    function readRow(row){
      if(!rendered(row)||!safePanel(row))return null;
      const title=titleOf(row),price=rowPrice(row,rendered),buttons=productButtons(row,rendered);
      if(!title||price===null)return null;
      const text=row.innerText.replace(title,""),button=buttons.length===1?buttons[0]:null;
      const state=soldOut.test(text)?"sold":soldWords.test(text)?"off":upcoming.test(text)?"upcoming":button&&!disabled(button,row)?"button":"unknown";
      const value=button?skin(button,row):"";
      const css=button&&button.ownerDocument.defaultView.getComputedStyle(button);
      let bright=!!button;
      for(let e=button;e&&e!==row.parentElement;e=e.parentElement)if(Number(e.ownerDocument.defaultView.getComputedStyle(e).opacity)<0.75)bright=false;
      const standard=bright&&css.backgroundColor==="rgb(254, 44, 85)"&&css.color==="rgb(255, 255, 255)";
      return {title,key:keyOf(title),price,row,button,state,value,standard,bright,explicit:button&&explicitOpen.test(text.replace(button.innerText,""))};
    }
    function open(item,at){
      if(!running||roomId()!==room||document.hidden||!document.hasFocus())return stop("窗口失去焦点或房间变化，本轮已停。");
      if(!atHitPoint(item.button))item.row.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});
      const same=readRow(item.row);
      if(!same||same.key!==item.key||same.price!==item.price||same.state!=="button"||same.button!==item.button||
         !(same.standard||same.explicit||offeredSkins.has(same.value))||!atHitPoint(same.button)){
        say("请露出已开售商品的按钮，助手正在重新核对。");return false;
      }
      const label=same.title+" ¥"+(same.price/100).toFixed(2);
      if(config.dry)stop("目标已可买 · "+label+"，本轮提醒结束。");
      else{
        const cancelCheckout=stop("已发出 1 次商品入口点击 · "+label+"。其他商品已停止守候。",{title:same.title,doc:same.button.ownerDocument});
        try{same.button.click();}catch{cancelCheckout?.();say("已尝试打开 "+label+"，请核对页面。");}
      }
      config.onWave?.("next",at,same.title);
      return true;
    }
    function scan(){
      if(!running||!list?.isConnected)return;
      if(roomId()!==room||document.hidden)return stop("已离开当前直播间，本轮已停。");
      const at=Date.now(),readyBefore=!config.twoWaves||!!firstSale;
      const items=[...list.querySelectorAll(rowQuery)].map(readRow).filter(Boolean),counts=new Map();
      if(!items.length)return;
      lastScan=at;
      if(at>reopenUntil)beforeReopen.clear();
      const addedToFullShelf=completeShelf&&items.length>lastLength;
      for(const i of items){
        counts.set(i.key,(counts.get(i.key)||0)+1);
        if(i.state==="button"&&i.bright&&(i.standard||i.explicit))offeredSkins.add(i.value);
      }
      const present=new Set(),openings=[];
      for(const i of items){
        const specified=picks.has(i.key);
        if(!specified&&!(config.newGoods&&i.price<=config.cap&&toy.test(i.title)&&!extra.test(i.title)))continue;
        if(!specified&&arrivals.get(i.key)!==i.price){
          arrivals.delete(i.key);
          if(initial||!addedToFullShelf||previousNames.has(i.key))continue;
          arrivals.set(i.key,i.price);
        }
        if(counts.get(i.key)!==1||(specified&&picks.get(i.key)!==i.price)){seen.delete(i.key);beforeReopen.delete(i.key);continue;}
        present.add(i.key);
        const state=i.state==="button"?(i.bright&&(i.standard||i.explicit||offeredSkins.has(i.value))?"available":"unknown"):i.state;
        const remembered=beforeReopen.get(i.key);
        const previous=seen.get(i.key)||(remembered?.price===i.price?remembered:null);
        if(state!=="unknown")beforeReopen.delete(i.key);
        const old=previous?.price===i.price?previous:null;
        const firstSeenNow=!previous&&!initial;
        const newEntry=!!old?.newEntry||(readyBefore&&firstSeenNow&&
          (specified?config.appearance:config.newGoods&&addedToFullShelf));
        if(state==="unknown"){
          if(!old)seen.set(i.key,{state,price:i.price,at,newEntry});
          continue;
        }
        if(previous?.state===state&&previous.price===i.price){
          if(!seen.has(i.key))seen.set(i.key,previous);
          if(previous.opening&&state==="available")openings.push(i);
          continue;
        }
        const opening=readyBefore&&state==="available"&&(old?.state==="sold"||old?.state==="upcoming"||newEntry);
        seen.set(i.key,{state,price:i.price,at,opening,newEntry:newEntry&&state==="off"});
        if(config.twoWaves&&!firstSale&&old?.state==="available"&&state==="sold"){
          firstSale={at,title:i.title};
          config.onWave?.("first",old.at,i.title);config.onWave?.("sold",at,i.title,i.row.innerText.match(soldOut)?.[0]);
        }
        if(opening)openings.push(i);
      }
      for(const key of seen.keys())if(!present.has(key))seen.delete(key);
      for(const key of arrivals.keys())if(!counts.has(key))arrivals.delete(key);
      previousNames=new Set(counts.keys());
      lastLength=items.length;
      completeShelf=/已逛完所有直播间宝贝|已展示全部商品|没有更多商品/.test(list.parentElement?.parentElement?.innerText||"");
      initial=false;
      if(openings.length){
        for(const item of openings){
          if(!running||open(item,at))break;
        }
        return;
      }
      say(config.twoWaves&&!firstSale?"多款同时守候，先等其中一款从可买变成已抢光。":
        firstSale?"已记录「"+firstSale.title+"」首轮售罄，等待清单中任一款下一次开放。":"多款同时守候，等待新的可售入口。");
    }
    function bind(){
      if(!running)return;
      const pages=documents();
      for(const [d,ob] of docs)if(!pages.includes(d)){ob.disconnect();docs.delete(d);}
      for(const d of pages)if(!docs.has(d)){
        const ob=new MutationObserver(rs=>{
          if(!list?.isConnected||rs.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches('iframe,[data-e2e="live-promotion-list"]')||n.querySelector?.('[data-e2e="live-promotion-list"]')))))bind();
        });ob.observe(d.documentElement,{subtree:true,childList:true});docs.set(d,ob);
      }
      let next=null;
      for(const d of pages){
        const official=[...d.querySelectorAll('[data-e2e="live-promotion-list"]')].filter(rendered);
        if(official.length===1){next=official[0];break;}
        next=[...d.querySelectorAll(listQuery)].find(l=>rendered(l)&&[...l.querySelectorAll(rowQuery)].some(r=>picks.has(keyOf(titleOf(r)))));
        if(next)break;
      }
      if(next!==list){
        if(list){
          beforeReopen.clear();
          if(!config.twoWaves&&list.matches('[data-e2e="live-promotion-list"]')&&Date.now()-lastScan<=3000){
            for(const [key,prior] of seen)if(picks.has(key)&&(prior.state==="sold"||prior.state==="upcoming"))beforeReopen.set(key,prior);
            reopenUntil=Date.now()+15000;
          }
        }
        if(next&&!next.matches('[data-e2e="live-promotion-list"]'))beforeReopen.clear();
        listObserver?.disconnect();seen.clear();offeredSkins.clear();arrivals.clear();previousNames.clear();initial=true;lastLength=0;completeShelf=false;
        if(firstSale)config.onWave?.("reset");
        firstSale=null;list=next||null;
        if(list){listObserver=new MutationObserver(scan);listObserver.observe(list,{subtree:true,childList:true,characterData:true,attributes:true});}
      }
      if(list)scan();else say("请打开购物袋，多款守候正在等商品列表。");
    }
    document.addEventListener("visibilitychange",()=>{if(document.hidden)stop("标签页已切到后台，本轮已停。");},{signal:listeners.signal});
    window.addEventListener("pagehide",()=>stop("已离开直播页。"),{signal:listeners.signal});
    timer=setInterval(bind,1000);bind();return stop;
  }
  globalThis.MaixuWatch={roomId,documents,describe,cardOf,start,startBatch};
})();
