const ProfilePage = (() => {
  const roleNames = {founder:'Основатель проекта',investor:'Инвестор',fund_staff:'Сотрудник фонда',super_admin:'Главный администратор'};
  const date = value => value ? new Date(value).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'}) : '—';
  const device = agent => /iPhone|iPad/i.test(agent||'') ? 'iPhone / iPad' : /Android/i.test(agent||'') ? 'Android' : /Macintosh/i.test(agent||'') ? 'Mac' : /Windows/i.test(agent||'') ? 'Windows' : 'Устройство';
  const initials = name => name.trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('');

  function render(root, data, api, onUpdate) {
    if (root._profileAvatarUrl) URL.revokeObjectURL(root._profileAvatarUrl);
    root._profileAvatarUrl = null;
    const user = data.user;
    root.className = 'profile-page';
    root.dataset.profileTab = 'details';
    root.innerHTML = `
      <div class="profile-heading"><h1>Личный кабинет</h1></div>
      <div class="profile-layout">
        <section class="profile-identity">
          <div class="profile-avatar" aria-hidden="true"><span id="profileInitials"></span><img id="profilePhoto" alt="" hidden></div>
          <div class="profile-identity-copy"><h2 id="profileDisplayName"></h2><p id="profileRole"></p></div>
          <div class="profile-photo-action"><button type="button" id="profilePhotoButton" class="profile-secondary">Загрузить фото</button><input id="profilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden><small id="profilePhotoStatus" role="status">JPG, PNG или WebP · до 2 МБ</small></div>
        </section>
        <nav class="profile-tabs" role="tablist" aria-label="Разделы личного кабинета"><button type="button" role="tab" data-profile-tab="details" aria-selected="true" aria-controls="profileDetailsPanel">Данные</button><button type="button" role="tab" data-profile-tab="password" aria-selected="false" aria-controls="profilePasswordPanel">Пароль</button><button type="button" role="tab" data-profile-tab="sessions" aria-selected="false" aria-controls="profileSessionsPanel">Сеансы</button></nav>
        <section class="profile-panel profile-details-panel" id="profileDetailsPanel"><div class="profile-panel-head"><h2>Личные данные</h2></div>
          <form id="profileDetailsForm" class="profile-form profile-details-form"><label>Имя и фамилия<input name="full_name" autocomplete="name" minlength="2" maxlength="120" required></label><label>Организация<input name="organization" autocomplete="organization" maxlength="160"></label><div class="profile-readonly"><span>Email для входа</span><strong id="profileEmail"></strong></div><div class="profile-readonly"><span>Телефон</span><strong id="profilePhone"></strong></div><div class="profile-form-foot"><span id="profileDetailsStatus" role="status"></span><button type="submit">Сохранить</button></div></form>
        </section>
        <section class="profile-panel profile-password-panel" id="profilePasswordPanel"><div class="profile-panel-head"><h2>Пароль</h2></div>
          <form id="profilePasswordForm" class="profile-form profile-password-form"><label>Текущий пароль<input type="password" name="current_password" autocomplete="current-password" required></label><label>Новый пароль<input type="password" name="new_password" autocomplete="new-password" minlength="12" maxlength="200" required></label><label>Повторите пароль<input type="password" name="confirm_password" autocomplete="new-password" minlength="12" maxlength="200" required></label><p class="profile-note">Не менее 12 символов. Другие сеансы завершатся.</p><div class="profile-form-foot"><span id="profilePasswordStatus" role="status"></span><button type="submit">Обновить пароль</button></div></form>
        </section>
        <section class="profile-panel profile-sessions-panel" id="profileSessionsPanel"><div class="profile-sessions-head"><h2>Сеансы</h2><button type="button" class="profile-secondary" id="profileRevokeOthers">Завершить другие</button></div><div id="profileCurrentSession" class="profile-sessions"></div><details id="profileOtherSessions" hidden><summary></summary><div id="profileOtherSessionList" class="profile-sessions"></div></details><span id="profileSessionsStatus" role="status"></span></section>
      </div>`;
    root.querySelector('#profileInitials').textContent = initials(user.full_name);
    root.querySelector('#profileDisplayName').textContent = user.full_name;
    const role=roleNames[user.role]||user.role;
    root.querySelector('#profileRole').textContent = user.full_name.trim().toLowerCase()===role.toLowerCase() ? user.email : role;
    root.querySelector('#profileEmail').textContent = user.email;
    root.querySelector('#profilePhone').textContent = user.phone || 'Не указан';
    root.querySelectorAll('[data-profile-tab]').forEach(button=>button.onclick=()=>{
      root.dataset.profileTab=button.dataset.profileTab;
      root.querySelectorAll('[data-profile-tab]').forEach(item=>item.setAttribute('aria-selected',String(item===button)));
    });
    const details = root.querySelector('#profileDetailsForm');
    details.elements.full_name.value = user.full_name;
    details.elements.organization.value = user.organization || '';

    function sessionRow(session) {
      const row=document.createElement('article');row.className='profile-session';
      const title=document.createElement('strong');title.textContent=device(session.user_agent)+(session.current?' · Этот сеанс':'');
      const description=document.createElement('small');description.textContent=`${session.ip_address||'Адрес не определён'} · ${date(session.created_at)}`;
      row.append(title,description);return row;
    }
    function drawSessions(items) {
      const current=root.querySelector('#profileCurrentSession'),otherList=root.querySelector('#profileOtherSessionList'),otherDetails=root.querySelector('#profileOtherSessions');
      current.replaceChildren();otherList.replaceChildren();
      const own=items.find(item=>item.current),others=items.filter(item=>!item.current);
      if(own)current.append(sessionRow(own));
      else current.textContent='Текущий сеанс не найден.';
      others.forEach(item=>otherList.append(sessionRow(item)));
      otherDetails.hidden=!others.length;
      otherDetails.querySelector('summary').textContent=`Другие сеансы: ${others.length}`;
      root.querySelector('#profileRevokeOthers').disabled=!others.length;
    }
    drawSessions(data.sessions);

    async function loadPhoto(){
      const response=await fetch('/api/profile/avatar',{headers:{Authorization:`Bearer ${localStorage.getItem('bokToken')}`},cache:'no-store'});
      if(response.status===404)return;
      if(!response.ok)throw new Error('Не удалось загрузить фото.');
      const image=root.querySelector('#profilePhoto');
      if(!image)return;
      if(root._profileAvatarUrl)URL.revokeObjectURL(root._profileAvatarUrl);
      root._profileAvatarUrl=URL.createObjectURL(await response.blob());
      image.src=root._profileAvatarUrl;image.hidden=false;root.querySelector('#profileInitials').hidden=true;
      root.querySelector('#profilePhotoButton').textContent='Изменить фото';
    }
    loadPhoto().catch(()=>{});
    root.querySelector('#profilePhotoButton').onclick=()=>root.querySelector('#profilePhotoInput').click();
    root.querySelector('#profilePhotoInput').onchange=async event=>{
      const file=event.target.files?.[0],status=root.querySelector('#profilePhotoStatus'),button=root.querySelector('#profilePhotoButton');
      if(!file)return;
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2_000_000){status.textContent='Выберите JPG, PNG или WebP до 2 МБ.';event.target.value='';return;}
      button.disabled=true;status.textContent='Загружаем фото…';
      try{
        const response=await fetch('/api/profile/avatar',{method:'POST',headers:{Authorization:`Bearer ${localStorage.getItem('bokToken')}`,'Content-Type':file.type},body:file});
        const result=await response.json();
        if(!response.ok)throw new Error(result.message||'Не удалось сохранить фото.');
        await loadPhoto();status.textContent='Фото сохранено.';
      }catch(error){status.textContent=error.message;}
      finally{button.disabled=false;event.target.value='';}
    };

    details.addEventListener('submit',async event=>{
      event.preventDefault();const button=details.querySelector('button'),status=root.querySelector('#profileDetailsStatus');
      button.disabled=true;status.textContent='Сохраняем…';
      try{
        const result=await api('/api/profile',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(details)))});
        root.querySelector('#profileDisplayName').textContent=result.full_name;
        root.querySelector('#profileInitials').textContent=initials(result.full_name);
        root.querySelector('#profileRole').textContent=result.full_name.trim().toLowerCase()===role.toLowerCase()?user.email:role;
        onUpdate(result);status.textContent='Сохранено.';
      }catch(error){status.textContent=error.message;}
      finally{button.disabled=false;}
    });
    const password=root.querySelector('#profilePasswordForm');
    password.addEventListener('submit',async event=>{
      event.preventDefault();const button=password.querySelector('button'),status=root.querySelector('#profilePasswordStatus');
      if(password.elements.new_password.value!==password.elements.confirm_password.value){status.textContent='Пароли не совпадают.';return;}
      button.disabled=true;status.textContent='Обновляем…';
      try{
        await api('/api/profile/password',{method:'POST',body:JSON.stringify({current_password:password.elements.current_password.value,new_password:password.elements.new_password.value})});
        password.reset();status.textContent='Пароль изменён.';
        const fresh=await api('/api/profile');drawSessions(fresh.sessions);
      }catch(error){status.textContent=error.message;}
      finally{button.disabled=false;}
    });
    root.querySelector('#profileRevokeOthers').onclick=async event=>{
      const button=event.currentTarget,status=root.querySelector('#profileSessionsStatus');button.disabled=true;status.textContent='Завершаем…';
      try{const result=await api('/api/profile/sessions/revoke-other',{method:'POST',body:'{}'});const fresh=await api('/api/profile');drawSessions(fresh.sessions);status.textContent=result.revoked?`Завершено сеансов: ${result.revoked}.`:'Других сеансов нет.';}
      catch(error){status.textContent=error.message;button.disabled=false;}
    };
  }
  return {render};
})();
