const statusNode=document.getElementById('inviteStatus');
const retryButton=document.getElementById('inviteRetry');
const inviteCode=location.hash.slice(1);
history.replaceState(null,'',location.pathname);

async function enterInvestor(){
  retryButton.hidden=true;
  statusNode.textContent='Создаём ваш личный кабинет…';
  try{
    if(!/^[A-Za-z0-9_-]{40,100}$/.test(inviteCode))throw new Error('Ссылка приглашения недействительна.');
    if(!globalThis.crypto?.getRandomValues)throw new Error('Откройте ссылку через защищённое соединение HTTPS.');
    const storageKey='bokInvestorInvite:'+inviteCode.slice(0,20);
    let browserKey=localStorage.getItem(storageKey);
    if(!browserKey){
      browserKey=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
      localStorage.setItem(storageKey,browserKey);
    }
    const response=await fetch('/api/auth/investor-invite',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code:inviteCode,browser_key:browserKey})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.message||'Не удалось открыть кабинет. Попробуйте позже.');
    localStorage.setItem('bokToken',result.token);
    location.replace('./index.html#dashboard');
  }catch(error){statusNode.textContent=error.message;retryButton.hidden=false;}
}
retryButton.onclick=enterInvestor;
enterInvestor();
