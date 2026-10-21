(function(root){
  'use strict';
  const KEY='calculus-promotion-v1';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  class CalculusSync {
    constructor({cloud,curriculum,Engine,storage,project,onStatus=()=>{}}){
      Object.assign(this,{cloud,curriculum,Engine,storage,project,onStatus});
      this.writer=root.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random();
      this.revision='0';this.pending=false;this.generation=0;this.active=false;this.timer=null;this.running=null;this.status='loading';this.lastSyncedAt=null;this.cacheAvailable=Boolean(storage);
    }
    _notify(){this.onStatus({status:this.status,pending:this.pending,lastSyncedAt:this.lastSyncedAt,cacheAvailable:this.cacheAvailable,message:this.error?.message||''});}
    _read(){try{return JSON.parse(this.storage?.getItem(this.cacheKey)||'null');}catch(_){this.cacheAvailable=false;return null;}}
    _checkpoint(force=false){
      // Keep state and pending/revision metadata in one atomic record.
      // A response from an older tab must never acknowledge another tab's edit.
      const current=this._read();
      if(!force&&current&&current.writer!==this.writer)return;
      try{
        if(!this.storage)throw Error('本机缓存不可用');
        this.storage.setItem(this.cacheKey,JSON.stringify({raw:this.raw,revision:this.revision,pending:this.pending,writer:this.writer,generation:this.generation}));
        this.cacheAvailable=true;
      }catch(_){this.cacheAvailable=false;}
    }
    _write(raw){
      this.raw=raw;
      // Engine construction probes its adapter; never mutate shared storage here.
      if(!this.active)return;
      this.generation++;this.pending=true;this._checkpoint(true);
      if(this.status!=='conflict'){this.status='pending';this._schedule();}
      this._notify();
    }
    _schedule(){clearTimeout(this.timer);if(this.active)this.timer=setTimeout(()=>this.flush().catch(()=>{}),900);}
    _checkRow(row){if(row&&row.userId!==this.user.id){const error=Error('账号已切换，请刷新页面后继续。');error.code='SESSION_CHANGED';throw error;}return row;}
    _validPending(checkpoint){
      if(!checkpoint||checkpoint.pending!==true||!/^\d+$/.test(String(checkpoint.revision))||typeof checkpoint.raw!=='string')return false;
      try{
        const state=JSON.parse(checkpoint.raw);
        return state.version===1&&['completed','mistakes','activity','settings'].every(key=>object(state[key]))&&
          ['answered','correct','xp','streak'].every(key=>Number.isSafeInteger(state[key])&&state[key]>=0)&&state.correct<=state.answered&&
          Object.hasOwn(state,'savedAt')&&Object.hasOwn(state,'activeSession');
      }catch(_){return false;}
    }
    async open(user){
      this.stop();this.user=user;this.cacheKey='calculus-account:'+this.project+':'+user.id+':checkpoint';
      const remote=this._checkRow(await this.cloud.loadProgress(user.id));
      // Re-read after loading so a newer local edit during the request is retained.
      const checkpoint=this._read(),pending=this._validPending(checkpoint);
      const remoteRevision=String(remote?.revision||'0');
      this.revision=pending?String(checkpoint.revision):remoteRevision;
      this.raw=pending?checkpoint.raw:remote?.state?JSON.stringify(remote.state):null;
      this.lastSyncedAt=remote?.updatedAt||null;
      const adapter={getItem:key=>key===KEY?this.raw:null,setItem:(key,value)=>{if(key===KEY)this._write(value);},removeItem:key=>{if(key===KEY)this._write(null);}};
      this.engine=new this.Engine(this.curriculum,adapter);
      this.pending=pending;this.active=true;this.error=null;
      if(pending&&this.revision!==remoteRevision){this.status='conflict';this.error=Error('另一台设备或标签页已经更新进度。请选择要保留的存档。');}
      else if(pending){this.status='pending';this._schedule();}
      else this.status='synced';
      if(pending)this._checkpoint(true);
      this._notify();return this.engine;
    }
    async flush(){
      clearTimeout(this.timer);
      if(!this.active)throw Error('同步已停止，请重新登录后继续。');
      if(this.status==='conflict')throw this.error;
      if(this.running)return this.running;
      this.running=this._drain();
      try{return await this.running;}finally{this.running=null;}
    }
    async _drain(){
      while(this.pending&&this.active){
        const generation=this.generation,snapshot=copy(this.engine.state);
        this.status='syncing';this.error=null;this._notify();
        try{
          const row=this._checkRow(await this.cloud.saveProgress(snapshot,this.revision,this.user.id));
          if(!this.active)throw Error('账号同步已停止。');
          this.revision=String(row.revision);this.lastSyncedAt=row.updatedAt;
          if(generation===this.generation)this.pending=false;
          this._checkpoint();this.status=this.pending?'pending':'synced';this._notify();
        }catch(error){
          this.error=error;this.status=error.code==='CONFLICT'?'conflict':'error';this._checkpoint();this._notify();throw error;
        }
      }
      return true;
    }
    async useCloud(){
      clearTimeout(this.timer);
      if(this.running)await this.running.catch(()=>{});
      const remote=this._checkRow(await this.cloud.loadProgress(this.user.id));
      this.active=false;this.revision=String(remote?.revision||'0');this.raw=remote?.state?JSON.stringify(remote.state):null;
      this.engine.load();this.pending=false;this.generation++;this.active=true;this.lastSyncedAt=remote?.updatedAt||null;this.error=null;this.status='synced';this._checkpoint(true);this._notify();
    }
    async keepLocal(){
      clearTimeout(this.timer);
      if(this.running)await this.running.catch(()=>{});
      const remote=this._checkRow(await this.cloud.loadProgress(this.user.id));
      this.revision=String(remote?.revision||'0');this.status='pending';this.pending=true;this._checkpoint(true);return this.flush();
    }
    async reset(){
      if(this.status==='conflict')throw this.error;
      if(this.running)await this.running;
      this.engine.state=new this.Engine(this.curriculum,null).state;
      this.engine.save();await this.flush();return true;
    }
    stop(){clearTimeout(this.timer);this.active=false;}
  }
  root.CalculusSync=CalculusSync;
  if(typeof module!=='undefined'&&module.exports)module.exports=CalculusSync;
})(typeof globalThis!=='undefined'?globalThis:window);

