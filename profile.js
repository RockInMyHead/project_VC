const ProfilePage = (() => {
  const roleNames = {founder:'Основатель проекта',investor:'Инвестор',fund_staff:'Сотрудник фонда',super_admin:'Главный администратор'};
  const date = value => value ? new Date(value).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'}) : '—';
  const device = agent => /iPhone|iPad/i.test(agent||'') ? 'iPhone / iPad' : /Android/i.test(agent||'') ? 'Android' : /Macintosh/i.test(agent||'') ? 'Mac' : /Windows/i.test(agent||'') ? 'Windows' : 'Устройство';

  function render(root, data, api, onUpdate) {
    const user = data.user;
    root.className = 'profile-page';
    root.innerHTML = `
      <div class="profile-heading"><h1>Личный кабинет</h1></div>
      <div class="profile-layout"><div class="profile-column">
        <section class="profile-identity"><div class="profile-avatar" id="profileAvatar" aria-hidden="true"></div><div><h2 id="profileDisplayName"></h2><p id="profileRole"></p></div></section>
        <section class="profile-panel"><div class="profile-panel-head"><h2>Личные данные</h2></div>
          <form id="profileDetailsForm" class="profile-form"><label>Имя и фамилия<input name="full_name" autocomplete="name" minlength="2" maxlength="120" required></label><label>Организация<input name="organization" autocomplete="organization" maxlength="160"></label><div class="profile-readonly"><span>Email для входа</span><strong id="profileEmail"></strong></div><div class="profile-readonly"><span>Телефон</span><strong id="profilePhone"></strong></div><p class="profile-note">Email и телефон меняет администратор — так доступ к аккаунту остаётся под контролем.</p><div class="profile-form-foot"><span id="profileDetailsStatus" role="status"></span><button type="submit">Сохранить изменения</button></div></form>
        </section>
      </div><div class="profile-column">
        <section class="profile-panel"><div class="profile-panel-head"><h2>Сменить пароль</h2></div>
          <form id="profilePasswordForm" class="profile-form"><label>Текущий пароль<input type="password" name="current_password" autocomplete="current-password" required></label><label>Новый пароль<input type="password" name="new_password" autocomplete="new-password" minlength="12" maxlength="200" required></label><label>Повторите новый пароль<input type="password" name="confirm_password" autocomplete="new-password" minlength="12" maxlength="200" required></label><p class="profile-note">От 12 символов. После смены пароля сеансы на других устройствах завершатся.</p><div class="profile-form-foot"><span id="profilePasswordStatus" role="status"></span><button type="submit">Обновить пароль</button></div></form>
        </section>
        <section class="profile-panel"><div class="profile-panel-head"><h2>Активные сеансы</h2></div><div id="profileSessions" class="profile-sessions"></div><div class="profile-form-foot"><span id="profileSessionsStatus" role="status"></span><button type="button" class="profile-secondary" id="profileRevokeOthers">Завершить другие сеансы</button></div></section>
      </div></div>`;
    root.querySelector('#profileAvatar').textContent = user.full_name.trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('');
    root.querySelector('#profileDisplayName').textContent = user.full_name;
    root.querySelector('#profileRole').textContent = roleNames[user.role] || user.role;
    root.querySelector('#profileEmail').textContent = user.email;
    root.querySelector('#profilePhone').textContent = user.phone || 'Не указан';
    const details = root.querySelector('#profileDetailsForm');
    details.elements.full_name.value = user.full_name;
    details.elements.organization.value = user.organization || '';

    const sessions = root.querySelector('#profileSessions');
    function drawSessions(items) {
      sessions.replaceChildren();
      for (const session of items) {
        const row = document.createElement('article');
        row.className = 'profile-session';
        const icon = document.createElement('span'); icon.className='profile-session-icon'; icon.textContent='◈';
        const body = document.createElement('div');
        const title = document.createElement('strong'); title.textContent=device(session.user_agent)+(session.current?' · Этот сеанс':'');
        const description = document.createElement('small'); description.textContent=`${session.ip_address || 'Адрес не определён'} · Вход ${date(session.created_at)}`;
        body.append(title,description); row.append(icon,body); sessions.append(row);
      }
      root.querySelector('#profileRevokeOthers').disabled = !items.some(item=>!item.current);
    }
    drawSessions(data.sessions);

    details.addEventListener('submit',async event=>{
      event.preventDefault(); const button=details.querySelector('button'); const status=root.querySelector('#profileDetailsStatus');
      button.disabled=true; status.textContent='Сохраняем…';
      try {
        const values=Object.fromEntries(new FormData(details));
        const result=await api('/api/profile',{method:'POST',body:JSON.stringify(values)});
        root.querySelector('#profileDisplayName').textContent=result.full_name;
        root.querySelector('#profileAvatar').textContent=result.full_name.trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('');
        onUpdate(result); status.textContent='Изменения сохранены.';
      } catch(error) { status.textContent=error.message; }
      finally { button.disabled=false; }
    });
    const password=root.querySelector('#profilePasswordForm');
    password.addEventListener('submit',async event=>{
      event.preventDefault(); const button=password.querySelector('button'); const status=root.querySelector('#profilePasswordStatus');
      if(password.elements.new_password.value!==password.elements.confirm_password.value){status.textContent='Новые пароли не совпадают.';return;}
      button.disabled=true; status.textContent='Обновляем…';
      try {
        await api('/api/profile/password',{method:'POST',body:JSON.stringify({current_password:password.elements.current_password.value,new_password:password.elements.new_password.value})});
        password.reset(); status.textContent='Пароль изменён. Другие сеансы завершены.';
        const fresh=await api('/api/profile'); drawSessions(fresh.sessions);
      } catch(error) { status.textContent=error.message; }
      finally { button.disabled=false; }
    });
    root.querySelector('#profileRevokeOthers').addEventListener('click',async event=>{
      const button=event.currentTarget, status=root.querySelector('#profileSessionsStatus');button.disabled=true;status.textContent='Завершаем…';
      try { const result=await api('/api/profile/sessions/revoke-other',{method:'POST',body:'{}'});const fresh=await api('/api/profile');drawSessions(fresh.sessions);status.textContent=result.revoked?`Завершено сеансов: ${result.revoked}.`:'Других сеансов нет.'; }
      catch(error){status.textContent=error.message;button.disabled=false;}
    });
  }
  return {render};
})();
