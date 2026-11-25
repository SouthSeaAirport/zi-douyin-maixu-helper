(() => {
  "use strict";
  const layerSelector = 'dialog,[role="dialog"],[aria-modal="true"],form,[data-e2e="checkout-panel"],[data-e2e="order-result"],.iEpMMH2v,[class*="content-transition-"]';
  const controls = 'button,input[type="submit"],[role="button"],[data-e2e="order-submit"],.iHAKgO8B';
  const action = /^(?:支付|立即支付|确认支付|提交订单|确认下单|立即下单)(?:[¥￥][\d,.]+)?$/;
  const stateNames = new Map([
    ["订单已提交，待付款","pending"], ["订单已提交,待付款","pending"], ["待付款","pending"],
    ["待支付","pending"], ["支付成功","paid"], ["付款成功","paid"], ["交易成功","paid"],
    ["支付已完成","paid"], ["买家已付款","paid"], ["交易关闭","closed"], ["订单已关闭","closed"]
  ]);
  const clean = text => String(text || "").replace(/\s+/g,"").trim();
  const clock = () => performance.timeOrigin + performance.now();
  function visible(el) {
    return el.isConnected && !!el.getClientRects().length && el.ownerDocument.defaultView.getComputedStyle(el).visibility === "visible";
  }
  function usable(el) {
    return visible(el) && !el.matches(":disabled") && !el.closest('[inert],[hidden],[aria-hidden="true"],[aria-disabled="true"]') &&
      el.ownerDocument.defaultView.getComputedStyle(el).pointerEvents !== "none";
  }
  function hasAction(el) {
    return action.test(clean(el.getAttribute("aria-label"))) || action.test(clean(el.tagName==="INPUT" ? el.value : el.textContent));
  }
  // The live web checkout uses a clickable div with a text node and a nested currency span.
  function submitButton(layer, excluded) {
    for(const el of layer.querySelectorAll(controls)) if(!excluded?.has(el) && hasAction(el) && usable(el)) return el;
    const walker=layer.ownerDocument.createTreeWalker(layer,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      if(!action.test(clean(node.nodeValue)) || node.parentElement.closest(controls))continue;
      for(let el=node.parentElement;el && el!==layer;el=el.parentElement){
        if(excluded?.has(el) || !hasAction(el))break;
        if(el.ownerDocument.defaultView.getComputedStyle(el).cursor==="pointer" && usable(el))return el;
      }
    }
    return null;
  }
  function receipt(layer, expected) {
    const walker=layer.ownerDocument.createTreeWalker(layer,NodeFilter.SHOW_TEXT);
    let state=null;
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      const candidate=stateNames.get(clean(node.nodeValue));
      if(candidate && visible(node.parentElement)){state=candidate;break;}
    }
    if(!state)return null;
    const text=clean(layer.innerText);
    const field=selector=>layer.querySelector(selector)?.innerText.trim()||"";
    const totalText=field('[data-e2e="order-total"],[data-e2e="order-pay-amount"]');
    const sum=clean(totalText).match(/[¥￥]?(\d+(?:\.\d{1,2})?)/) ||
      text.match(/(?:订单已提交[，,]待付款|实付金额|应付金额|支付金额|订单金额|订单总额|实付款|实付)[:：]?[¥￥](\d+(?:\.\d{1,2})?)/);
    const quantityText=field('[data-e2e="order-quantity"]')||text.match(/(?:购买数量|商品数量)[:：]?(\d+)件?/)?.[1]||"";
    return {state,title:field('[data-e2e="order-product-title"]') || (text.includes(clean(expected))?expected:""),
      amount:sum?.[1]||"",quantity:quantityText,spec:field('[data-e2e="order-sku"]')};
  }
  function follow(entry, report, release) {
    const room=globalThis.MaixuWatch.roomId(), observers=new Map(), events=new AbortController();
    const existing=new WeakSet();
    let stopped=false, sent=false, released=false, lastReceipt="", clickedAt=null, receivedAt=null, expiredTimer;
    function unlock(){if(!released){released=true;release();}}
    function stop(message){
      if(stopped)return;
      stopped=true;clearTimeout(expiredTimer);events.abort();
      for(const observer of observers.values())observer.disconnect();
      observers.clear();
      if(message)report({state:"stopped",clickedAt,receivedAt},message);
      unlock();
    }
    function inspect(layer){
      if(stopped || !visible(layer))return;
      if((!sent && document.hidden) || globalThis.MaixuWatch.roomId()!==room){stop(sent?"":"本轮已停止。");return;}
      if(sent){
        const result=receipt(layer,entry.title);
        if(!result)return;
        const signature=JSON.stringify(result);
        if(signature!==lastReceipt){lastReceipt=signature;report({...result,clickedAt,receivedAt,observedAt:clock()});}
        unlock();
        return;
      }
      const button=submitButton(layer,existing);
      if(!button)return;
      // Consume the one click before dispatch, including synchronous re-render or an exception.
      sent=true;
      button.addEventListener("click",()=>{receivedAt=clock();},{capture:true,once:true});
      clickedAt=clock();
      try{button.click();}catch{report({state:"unknown",clickedAt,receivedAt},"已尝试点击结算按钮，请在订单页查看结果。");stop();return;}
      report({state:"sent",clickedAt,receivedAt},"已点 1 次结算按钮，等待订单结果。");
    }
    function collect(el, layers){
      if(!el || el.closest('#maixu-queue-panel,[data-e2e="live-promotion-list"],[role="log"]'))return;
      const parent=el.closest(layerSelector);
      if(parent)layers.add(parent);
      if(!parent)for(const layer of el.querySelectorAll(layerSelector))layers.add(layer);
      if(el.matches("iframe")||el.querySelector("iframe"))bindFrames();
    }
    function bind(doc){
      if(stopped || observers.has(doc) || !doc.documentElement)return;
      const observer=new MutationObserver(records=>{
        const layers=new Set();
        for(const record of records){
          if(record.type==="childList"){
            for(const n of record.addedNodes)collect(n.nodeType===1?n:n.parentElement,layers);
          }else collect(record.target.nodeType===1?record.target:record.target.parentElement,layers);
        }
        for(const layer of layers)inspect(layer);
      });
      observers.set(doc,observer);
      observer.observe(doc.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
        attributeFilter:["class","style","hidden","open","inert","disabled","aria-hidden","aria-disabled","aria-label","role","data-e2e"]});
      doc.addEventListener("load",e=>{
        if(e.target?.tagName!=="IFRAME")return;
        bindFrames();
      },{capture:true,signal:events.signal});
      doc.addEventListener("click",e=>{
        if(!sent && e.isTrusted && e.target.closest?.('[data-e2e="shop-buyBtn"]'))stop("已切换商品，本轮已停止。");
      },{capture:true,signal:events.signal});
    }
    function bindFrames(){
      for(const doc of globalThis.MaixuWatch.documents()){
        if(observers.has(doc))continue;
        bind(doc);
        // A newly loaded, same-origin checkout frame can already contain its entire UI.
        for(const layer of doc.querySelectorAll(layerSelector))inspect(layer);
      }
    }
    for(const doc of new Set([document,entry.doc,...globalThis.MaixuWatch.documents()])){
      bind(doc);
      // A checkout already on screen belongs to an earlier action.
      for(const layer of doc.querySelectorAll(layerSelector)){
        if(!visible(layer))continue;
        const old=submitButton(layer);
        if(old)existing.add(old);
      }
    }
    document.addEventListener("visibilitychange",()=>{if(!sent && document.hidden)stop("已切到后台，本轮已停止。");},{signal:events.signal});
    window.addEventListener("pagehide",()=>stop(),{signal:events.signal});
    window.addEventListener("popstate",()=>{if(globalThis.MaixuWatch.roomId()!==room)stop("已切换直播间，本轮已停止。");},{signal:events.signal});
    // A missing checkout (for example a phone-only QR) must not arm a future, unrelated purchase.
    expiredTimer=setTimeout(()=>stop(lastReceipt?"":sent?"已点过结算按钮，请在抖音订单页查看结果。":"本次商品未显示网页结算按钮，本轮已结束。"),120000);
    return stop;
  }
  globalThis.MaixuCheckout={follow,submitButton,layerSelector};
})();
