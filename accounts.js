(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const app=()=>document.getElementById('app');
  const baseUrl=()=>{const url=new URL(location.href);url.search='';url.hash='';return url.href;};
  function shell(content){
    app().innerHTML=`<main class="account-shell"><section class="account-story"><a class="account-brand" href="./"><span>∫</span>微积分晋级<small>CALCULUS QUEST</small></a><div class="account-story-main"><div class="eyebrow">YOUR PROGRESS, YOUR JOURNEY</div><h1>每一次突破，<br>都值得被记住。</h1><p>从青铜到王者，让微积分的每一步进阶，<br>都成为属于你的成长记录。</p><div class="account-orbit" aria-hidden="true"><span>∫</span><i>lim</i><b>f′(x)</b></div></div><div class="account-features"><span>21 个学习关卡</span><span>84 道精选题</span><span>账号进度同步</span></div></section><section class="account-form-area">${content}</section></main>`;
  }
  function notice(message,error=false){const element=document.getElementById('account-message');if(element){element.textContent=message;element.className=`account-message ${error?'error':''}`;element.hidden=false;}}
  async function open(curriculum,Engine){
    const config=root.CALCULUS_CONFIG||{};
    if(config.mode==='offline')return {mode:'offline',engine:new Engine(curriculum),user:null,teacher:false,onStatus:()=>{},flush:async()=>true,reset:async function(){this.engine.reset();return this.engine.storageAvailable;}};
    if(!config.url||!config.publishableKey||!root.supabase?.createClient){
      shell(`<div class="account-form"><div class="eyebrow">READY FOR YOUR CLASSROOM</div><h2>账号服务尚未连接</h2><p class="account-intro">注册版需要连接认证与数据库服务，配置完成后即可开放学生注册。</p><div class="account-setup">网站管理者需要设置 Supabase 项目地址、公开发布密钥，并初始化学习记录数据表。</div><p class="account-footnote">当前页面不会创建模拟账号，也不会把学生密码保存到浏览器。</p><button class="primary" id="config-retry">重新检查配置</button></div>`);
      document.getElementById('config-retry').onclick=()=>location.reload();
      return new Promise(()=>{});
    }
    const cloud=new root.CalculusCloud(config,root.supabase.createClient);
    const recoveryKey='calculus-recovery:'+new URL(config.url).hostname;
    let recovery=false,account=null;
    try{recovery=root.sessionStorage.getItem(recoveryKey)==='1';}catch(_){}
    const setRecovery=value=>{recovery=value;try{if(value)root.sessionStorage.setItem(recoveryKey,'1');else root.sessionStorage.removeItem(recoveryKey);}catch(_){}};
    // Subscribe before loading progress: a delayed login retry must not bind a
    // new session to the previous student's cache or teacher permissions.
    cloud.onAuthChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY'){
        setRecovery(true);
        if(account){account.sync?.stop();location.reload();}
      }else if(account&&(event==='SIGNED_OUT'||session?.user?.id&&session.user.id!==account.user.id)){
        if(event==='SIGNED_OUT')setRecovery(false);
        account.sync?.stop();location.reload();
      }
    });
    const auth=await new Promise(resolve=>{
      let busy=false;
      const show=(mode='signin')=>{
        const signup=mode==='signup',forgot=mode==='forgot',recover=mode==='recover';
        shell(`<div class="account-form"><div class="eyebrow">${signup?'BEGIN YOUR JOURNEY':recover?'A FRESH START':'WELCOME BACK, EXPLORER'}</div><h2>${signup?'创建学习账号':forgot?'找回密码':recover?'设置新密码':'继续你的晋级之旅'}</h2><p class="account-intro">${signup?'注册后即可开始学习，段位和关卡会保存到你的账号。':forgot?'输入注册邮箱，我们会发送密码重置链接。':recover?'为你的账号设置新密码，然后继续学习。':'登录账号，从上次停下的地方继续。'}</p>${!forgot&&!recover?`<div class="account-tabs"><button data-auth-mode="signin" class="${signup?'':'active'}">登录</button><button data-auth-mode="signup" class="${signup?'active':''}">注册</button></div>`:''}<form id="account-form">${signup?'<label for="auth-name">学生昵称<input id="auth-name" name="displayName" autocomplete="nickname" required minlength="2" maxlength="40" placeholder="用于辨认你的学习记录"></label>':''}${!recover?'<label for="auth-email">邮箱<input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label>':''}${!forgot?`<label for="auth-password">${recover?'新密码':'密码'}<input id="auth-password" name="password" type="password" autocomplete="${signup||recover?'new-password':'current-password'}" required minlength="${signup||recover?10:1}" maxlength="128" placeholder="${signup||recover?'至少 10 位字符':'输入你的密码'}"></label>`:''}${signup||recover?'<label for="auth-confirm">确认密码<input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="再次输入密码"></label>':''}<div id="account-message" class="account-message" role="status" hidden></div><button class="primary account-submit" type="submit">${signup?'注册学习账号':forgot?'发送重置邮件':recover?'保存新密码':'登录并继续'} <span>→</span></button></form>${!signup&&!forgot&&!recover?'<button class="account-link" data-auth-mode="forgot">忘记密码？</button>':''}${forgot?'<button class="account-link" data-auth-mode="signin">返回登录</button>':''}<p class="account-footnote">${signup?'注册后请按邮件提示验证邮箱。你的昵称和学习段位可供课程教师查看。':'学习记录按账号分别保存。密码由认证服务处理，不存入游戏代码或学习记录。'}</p></div>`);
        document.querySelectorAll('[data-auth-mode]').forEach(button=>button.onclick=()=>{if(!busy)show(button.dataset.authMode);});
        document.getElementById('account-form').onsubmit=async event=>{
          event.preventDefault();if(busy)return;
          const form=event.currentTarget,fields=new FormData(form);
          const email=String(fields.get('email')||'').trim(),password=String(fields.get('password')||'');
          if((signup||recover)&&password!==fields.get('confirm')){notice('两次输入的密码不一致。',true);return;}
          busy=true;const button=form.querySelector('[type="submit"]');button.disabled=true;
          try{
            if(forgot){await cloud.resetPassword(email,baseUrl());notice('如果此邮箱已注册，将收到密码重置邮件。请在当前浏览器打开链接。');}
            else if(recover){await cloud.updatePassword(password);form.reset();setRecovery(false);resolve(await cloud.init());}
            else if(signup){const result=await cloud.signUp(email,password,String(fields.get('displayName')).trim(),baseUrl());form.querySelectorAll('input[type="password"]').forEach(input=>input.value='');if(result.session&&result.user)resolve(result);else notice('请查看邮箱并完成验证，然后回到这里登录。验证邮件可能在垃圾邮件中。');}
            else{const result=await cloud.signIn(email,password);form.reset();resolve(result);}
          }catch(error){notice(error.message||'暂时无法连接账号服务，请稍后重试。',true);}
          finally{busy=false;if(button.isConnected)button.disabled=false;}
        };
      };
      (async()=>{
        shell('<div class="account-form"><div class="eyebrow">WELCOME BACK</div><h2>正在读取你的账号…</h2><p class="account-intro">请稍候，我们正在连接学习记录。</p></div>');
        try{const current=await cloud.init();await new Promise(r=>setTimeout(r,0));if(recovery&&current.session)show('recover');else if(current.user&&current.session)resolve(current);else{setRecovery(false);show();}}
        catch(error){show();notice(error.message||'账号服务暂时无法连接。',true);}
      })();
    });
    account={user:auth.user};
    // Keep one editable tab per account in this browser. Cross-device edits are
    // still resolved by the database revision, while local drafts cannot race.
    await new Promise(resolve=>{
      if(!root.navigator?.locks?.request){
        shell('<div class="account-form"><h2>请使用新版浏览器</h2><p class="account-intro">此浏览器无法协调多个标签页的学习存档。请使用最新版 Edge、Chrome、Firefox 或 Safari 打开网站。</p></div>');
        return;
      }
      const attempt=()=>{
        root.navigator.locks.request('calculus-study:'+new URL(config.url).hostname+':'+auth.user.id,{ifAvailable:true},async lock=>{
          if(lock){resolve();await new Promise(()=>{});return;}
          shell('<div class="account-form"><h2>学习账号已在另一个标签页打开</h2><p class="account-intro">请继续使用原来的标签页，或先关闭原来的游戏页面，再在这里继续。这样可以避免两份学习进度互相覆盖。</p><button class="primary" id="account-tab-retry">原页面已关闭，继续学习</button></div>');
          document.getElementById('account-tab-retry').onclick=attempt;
        }).catch(error=>{
          shell(`<div class="account-form"><h2>暂时无法打开学习记录</h2><p class="account-intro">${escape(error.message||'请刷新页面后重试。')}</p><button class="primary" id="account-tab-retry">重新检查</button></div>`);
          document.getElementById('account-tab-retry').onclick=attempt;
        });
      };attempt();
    });
    const listeners=new Set();
    let storage=null;try{storage=root.localStorage;}catch(_){}
    account={mode:'cloud',cloud,user:auth.user,teacher:false,transitioning:false,status:{status:'loading'},onStatus:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}};
    const sync=new root.CalculusSync({cloud,curriculum,Engine,storage,project:new URL(config.url).hostname,onStatus:status=>{account.status=status;for(const listener of listeners)listener(status);}});
    account.sync=sync;
    await new Promise(resolve=>{
      const load=async()=>{
        shell('<div class="account-form"><div class="eyebrow">YOUR LEARNING RECORD</div><h2>正在同步学习进度…</h2><p class="account-intro">首次登录会建立你的个人学习记录。</p></div>');
        try{account.engine=await sync.open(auth.user);account.teacher=await cloud.isTeacher(auth.user.id);resolve();}
        catch(error){shell(`<div class="account-form"><h2>暂时无法读取云端进度</h2><p class="account-intro">${escape(error.message||'请检查网络后重试。')}</p><div class="account-setup">为避免覆盖已有记录，连接恢复之前不会创建空白存档。</div><button class="primary" id="account-retry">重新连接</button><button class="account-link" id="account-exit">退出账号</button><div id="account-message" role="status" hidden></div></div>`);document.getElementById('account-retry').onclick=load;document.getElementById('account-exit').onclick=async()=>{try{sync.stop();await cloud.signOut();location.reload();}catch(error){notice(error.message,true);}};}
      };load();
    });
    account.flush=()=>sync.flush();
    account.reset=async()=>{
      account.transitioning=true;app().inert=true;
      try{return await sync.reset();}
      finally{account.transitioning=false;app().inert=false;}
    };
    account.signOut=async()=>{
      account.transitioning=true;app().inert=true;
      try{
        try{await sync.flush();}catch(error){if(!sync.cacheAvailable)throw error;}
        const result=await cloud.signOut();sync.stop();setRecovery(false);location.reload();return result;
      }catch(error){account.transitioning=false;app().inert=false;throw error;}
    };
    account.listStudents=(offset=0,limit=100)=>cloud.listStudents(offset,limit,auth.user.id);
    account.resolveConflict=choice=>choice==='cloud'?sync.useCloud():sync.keepLocal();
    return account;
  }
  root.CalculusAccounts={open};
})(window);
