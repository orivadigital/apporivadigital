(function () {
  'use strict';

  var chatState = {
    conversations: [],
    participants: [],
    automaticRecipientNames: ['Lucas', 'Arsênio', 'Alexandre'],
    actor: null,
    selectedId: '',
    filter: 'todos',
    polling: null,
    refreshPromise: null,
    threadRequestId: 0,
    drafts: Object.create(null),
    sending: Object.create(null)
  };

  var esc = window.orivaEscape;
  var api = window.orivaApi;
  var toast = window.orivaToast;

  var typeLabels = {
    mensagem: 'Conversa',
    duvida_demanda: 'Dúvida sobre demanda',
    nova_demanda: 'Solicitação de nova demanda'
  };

  function agencyRole() {
    return chatState.actor && (chatState.actor.role === 'super_admin' || chatState.actor.role === 'socio');
  }

  function pageId() {
    var role = window.orivaCurrentActor && window.orivaCurrentActor.role;
    if (role === 'empresa_cliente') return 'c-chat';
    if (role === 'parceiro') return 'p-chat';
    return 'chat';
  }

  function formatChatDate(value, short) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var today = new Date();
    if (short && date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleString('pt-BR', short
      ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { dateStyle: 'short', timeStyle: 'short' });
  }

  function pageCopy() {
    var role = window.orivaCurrentActor && window.orivaCurrentActor.role;
    if (role === 'empresa_cliente') return {
      title: 'Falar com a Óriva',
      description: 'Converse diretamente com os sócios e solicite novas demandas com segurança.',
      button: '+ Nova conversa'
    };
    if (role === 'colaborador' || role === 'parceiro') return {
      title: 'Falar com os sócios',
      description: 'Tire dúvidas sobre suas demandas. Lucas, Arsênio e Alexandre recebem cada nova conversa.',
      button: '+ Nova dúvida'
    };
    return {
      title: 'Central de conversas',
      description: 'Atenda clientes e organize conversas internas individuais ou em grupo.',
      button: '+ Nova conversa'
    };
  }

  function chatPage() {
    var copy = pageCopy();
    window.setTimeout(loadChat, 0);
    return '<div class="page-head chat-page-head"><div><h1 class="page-title">' + esc(copy.title) + '</h1>' +
      '<p class="page-desc">' + esc(copy.description) + '</p></div>' +
      '<button class="btn btn-primary" type="button" onclick="openChatForm()">' + esc(copy.button) + '</button></div>' +
      '<div id="chat-area"><div class="loading-state"><div class="spinner"></div>Carregando conversas...</div></div>';
  }

  paginas.chat = chatPage;
  paginas['c-chat'] = chatPage;
  paginas['p-chat'] = chatPage;

  async function loadChat(silent) {
    var area = document.getElementById('chat-area');
    if (!area) return;
    if (!silent) area.innerHTML = '<div class="loading-state"><div class="spinner"></div>Carregando conversas...</div>';
    try {
      var payload = await api('/api/chat');
      chatState.conversations = payload.conversations || [];
      chatState.participants = payload.participants || [];
      chatState.automaticRecipientNames = payload.automaticRecipientNames || chatState.automaticRecipientNames;
      chatState.actor = payload.actor || null;
      if (chatState.selectedId && !chatState.conversations.some(function (item) { return item.id === chatState.selectedId; })) {
        chatState.selectedId = '';
      }
      var canKeepOpenThread = Boolean(
        silent && chatState.selectedId && document.getElementById('chat-thread-panel')
      );
      if (canKeepOpenThread) {
        renderChatList();
        await loadChatThread(chatState.selectedId, true);
      } else {
        renderChat();
        if (chatState.selectedId) await loadChatThread(chatState.selectedId, true);
      }
      startChatPolling();
    } catch (error) {
      if (!silent) area.innerHTML = '<div class="card management-empty"><h3>Não foi possível carregar o bate-papo</h3><p>' + esc(error.message) + '</p><button class="btn btn-primary" type="button" onclick="loadChat()">Tentar novamente</button></div>';
    }
  }

  function filteredConversations() {
    if (chatState.filter === 'todos') return chatState.conversations;
    if (chatState.filter === 'nova_demanda') return chatState.conversations.filter(function (item) { return item.type === 'nova_demanda'; });
    if (chatState.filter === 'grupo') return chatState.conversations.filter(function (item) { return item.isGroup && item.status !== 'arquivada'; });
    if (chatState.filter === 'arquivada') return chatState.conversations.filter(function (item) { return item.status === 'arquivada'; });
    return chatState.conversations.filter(function (item) { return item.participantRole === chatState.filter && item.status !== 'arquivada'; });
  }

  function filterButtons() {
    var buttons = [{ value: 'todos', label: 'Todas' }];
    if (agencyRole()) {
      buttons = buttons.concat([
        { value: 'empresa_cliente', label: 'Clientes' },
        { value: 'colaborador', label: 'Colaboradores' },
        { value: 'parceiro', label: 'Parceiros' },
        { value: 'grupo', label: 'Grupos' },
        { value: 'nova_demanda', label: 'Novas demandas' },
        { value: 'arquivada', label: 'Arquivadas' }
      ]);
    } else {
      buttons.push({ value: 'arquivada', label: 'Arquivadas' });
    }
    return '<div class="chat-filters" aria-label="Filtros das conversas">' + buttons.map(function (button) {
      return '<button class="chat-filter' + (chatState.filter === button.value ? ' active' : '') + '" type="button" onclick="setChatFilter(\'' + button.value + '\')">' + esc(button.label) + '</button>';
    }).join('') + '</div>';
  }

  function conversationCard(item) {
    var meta = agencyRole()
      ? (item.isGroup ? 'Grupo · ' + (item.memberSummary || 'Equipe Óriva') : item.participantName + ' · ' + item.participantRoleLabel)
      : (item.isGroup ? 'Grupo com os sócios da Óriva' : (item.companyName || typeLabels[item.type] || 'Equipe Óriva'));
    return '<button class="chat-conversation' + (item.id === chatState.selectedId ? ' active' : '') + '" type="button" data-chat-id="' + esc(item.id) + '" onclick="openChatConversation(\'' + esc(item.id) + '\')">' +
      '<span class="chat-conversation-top"><strong>' + esc(item.subject) + '</strong><time>' + esc(formatChatDate(item.lastMessageAt, true)) + '</time></span>' +
      '<span class="chat-conversation-meta">' + esc(meta) + '</span>' +
      '<span class="chat-conversation-bottom"><span>' + esc(item.lastMessage) + '</span>' + (item.unread ? '<b class="chat-unread" aria-label="' + item.unread + ' mensagens não lidas">' + item.unread + '</b>' : '') + '</span>' +
      (item.type === 'nova_demanda' ? '<em class="chat-demand-badge">Nova demanda</em>' : '') +
      '</button>';
  }

  function conversationListHtml() {
    var list = filteredConversations();
    return list.length
      ? list.map(conversationCard).join('')
      : '<div class="chat-list-empty"><div>💬</div><strong>Nenhuma conversa neste filtro</strong><span>Inicie uma conversa para centralizar a comunicação.</span><button class="btn btn-primary" type="button" onclick="openChatForm()">Iniciar conversa</button></div>';
  }

  function renderChatList() {
    var listPanel = document.querySelector('#chat-area .chat-list-panel');
    var layout = document.querySelector('#chat-area .chat-layout');
    if (!listPanel || !layout) {
      renderChat();
      return;
    }
    listPanel.innerHTML = conversationListHtml();
    layout.classList.toggle('mobile-thread-open', Boolean(chatState.selectedId));
  }

  function renderChat() {
    var area = document.getElementById('chat-area');
    if (!area) return;
    area.innerHTML = filterButtons() + '<div class="chat-layout' + (chatState.selectedId ? ' mobile-thread-open' : '') + '">' +
      '<aside class="chat-list-panel" aria-label="Lista de conversas">' + conversationListHtml() + '</aside>' +
      '<section class="chat-thread-panel" id="chat-thread-panel">' +
      '<div class="chat-thread-empty"><div class="chat-empty-icon">' + ico.chat + '</div><h3>Selecione uma conversa</h3><p>As mensagens ficam salvas e disponíveis somente para os participantes autorizados.</p></div>' +
      '</section></div>';
  }

  function setChatFilter(value) {
    chatState.filter = value;
    chatState.selectedId = '';
    renderChat();
  }

  async function openChatConversation(id) {
    chatState.selectedId = id;
    renderChat();
    await loadChatThread(id, false);
  }

  async function loadChatThread(id, silent) {
    if (chatState.selectedId !== id) return;
    var panel = document.getElementById('chat-thread-panel');
    if (!panel) return;
    var requestId = ++chatState.threadRequestId;
    if (!silent) panel.innerHTML = '<div class="loading-state"><div class="spinner"></div>Carregando mensagens...</div>';
    try {
      var payload = await api('/api/chat/' + encodeURIComponent(id));
      if (chatState.selectedId !== id || requestId !== chatState.threadRequestId) return;
      renderChatThread(payload.conversation, payload.messages || []);
      api('/api/chat/' + encodeURIComponent(id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read' })
      }).catch(function () {});
      var item = chatState.conversations.find(function (conversation) { return conversation.id === id; });
      if (item) item.unread = 0;
      var card = document.querySelector('[data-chat-id="' + id + '"] .chat-unread');
      if (card) card.remove();
    } catch (error) {
      if (chatState.selectedId !== id || requestId !== chatState.threadRequestId) return;
      panel.innerHTML = '<div class="chat-thread-empty"><h3>Não foi possível abrir a conversa</h3><p>' + esc(error.message) + '</p><button class="btn btn-primary" type="button" onclick="openChatConversation(\'' + esc(id) + '\')">Tentar novamente</button></div>';
    }
  }

  function renderChatThread(conversation, messages) {
    var panel = document.getElementById('chat-thread-panel');
    if (!panel) return;
    var currentComposer = panel.querySelector('.chat-composer[data-chat-id="' + conversation.id + '"] textarea');
    var currentMessages = panel.querySelector('#chat-messages');
    var restoreFocus = Boolean(currentComposer && document.activeElement === currentComposer);
    var selectionStart = currentComposer && currentComposer.selectionStart;
    var selectionEnd = currentComposer && currentComposer.selectionEnd;
    var previousScrollTop = currentMessages ? currentMessages.scrollTop : 0;
    var wasNearBottom = !currentMessages || currentMessages.scrollHeight - currentMessages.scrollTop - currentMessages.clientHeight < 80;
    if (currentComposer) chatState.drafts[conversation.id] = currentComposer.value;
    var draft = chatState.drafts[conversation.id] || '';
    var sending = Boolean(chatState.sending[conversation.id]);
    var summary = chatState.conversations.find(function (item) { return item.id === conversation.id; }) || {};
    var archived = conversation.status === 'arquivada';
    var members = conversation.members || summary.members || [];
    var memberNames = members.map(function (member) { return member.name; }).filter(Boolean);
    var threadMeta = conversation.isGroup
      ? 'Grupo · ' + (memberNames.length ? memberNames.join(', ') : 'Equipe Óriva')
      : (agencyRole() ? ((summary.participantName || 'Participante') + ' · ' + (summary.participantRoleLabel || '')) : 'Conversa privada com a equipe Óriva');
    panel.innerHTML = '<header class="chat-thread-head">' +
      '<button class="chat-back-button" type="button" aria-label="Voltar às conversas" onclick="closeChatThread()">‹</button>' +
      '<div><h2>' + esc(conversation.subject) + '</h2><p>' + esc(threadMeta) + '</p></div>' +
      (agencyRole() ? '<button class="btn btn-ghost btn-compact" type="button" onclick="toggleChatArchive(\'' + esc(conversation.id) + '\',\'' + (archived ? 'reopen' : 'archive') + '\')">' + (archived ? 'Reabrir' : 'Arquivar') + '</button>' : '') +
      '</header>' +
      '<div class="chat-context">' +
      '<span>' + esc(typeLabels[summary.type] || 'Conversa') + '</span>' +
      (conversation.isGroup ? '<span>' + members.length + ' participantes</span>' : '') +
      (summary.companyName ? '<span>Empresa: ' + esc(summary.companyName) + '</span>' : '') +
      (summary.relatedTaskTitle ? '<span>Demanda: ' + esc(summary.relatedTaskTitle) + '</span>' : '') +
      '</div>' +
      '<div class="chat-messages" id="chat-messages">' + (messages.length ? messages.map(function (message) {
        var sender = message.senderName || (message.own ? 'Você' : message.side === 'agency' ? 'Equipe Óriva' : (summary.participantName || 'Participante'));
        return '<article class="chat-message ' + (message.own ? 'own' : '') + '"><div class="chat-bubble"><b>' + esc(sender) + '</b><p>' + esc(message.body).replace(/\n/g, '<br>') + '</p><time>' + esc(formatChatDate(message.createdAt, false)) + '</time></div></article>';
      }).join('') : '<div class="chat-thread-empty"><p>Ainda não há mensagens nesta conversa.</p></div>') + '</div>' +
      (archived
        ? '<div class="chat-archived-note">Esta conversa está arquivada. ' + (agencyRole() ? 'Reabra para enviar novas mensagens.' : 'A equipe pode reabri-la quando necessário.') + '</div>'
        : '<form class="chat-composer" data-chat-id="' + esc(conversation.id) + '" onsubmit="sendChatMessage(event,\'' + esc(conversation.id) + '\')"><textarea name="message" rows="2" maxlength="5000" required placeholder="Escreva sua mensagem..." oninput="saveChatDraft(\'' + esc(conversation.id) + '\',this.value)">' + esc(draft) + '</textarea><button class="btn btn-primary" type="submit"' + (sending ? ' disabled' : '') + '>' + (sending ? 'Enviando...' : 'Enviar') + '</button></form>');
    var messagesRoot = document.getElementById('chat-messages');
    if (messagesRoot) {
      messagesRoot.scrollTop = wasNearBottom ? messagesRoot.scrollHeight : previousScrollTop;
    }
    var restoredComposer = panel.querySelector('.chat-composer[data-chat-id="' + conversation.id + '"] textarea');
    if (restoreFocus && restoredComposer) {
      restoredComposer.focus();
      if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
        restoredComposer.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }

  function saveChatDraft(id, value) {
    chatState.drafts[id] = String(value == null ? '' : value);
  }

  async function sendChatMessage(event, id) {
    event.preventDefault();
    if (chatState.sending[id]) return;
    var form = event.currentTarget;
    var textarea = form.elements.message;
    var button = form.querySelector('button[type="submit"]');
    var message = textarea.value.trim();
    if (!message) return;
    chatState.drafts[id] = textarea.value;
    chatState.sending[id] = true;
    button.disabled = true;
    button.textContent = 'Enviando...';
    try {
      await api('/api/chat/' + encodeURIComponent(id) + '/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: message })
      });
      delete chatState.drafts[id];
      textarea.value = '';
      await refreshChat(true);
      textarea = document.querySelector('.chat-composer textarea');
      if (textarea) textarea.focus();
    } catch (error) {
      toast(error.message, true);
    } finally {
      chatState.sending[id] = false;
      var currentButton = document.querySelector('.chat-composer[data-chat-id="' + id + '"] button[type="submit"]');
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = 'Enviar';
      }
    }
  }

  function closeChatThread() {
    chatState.selectedId = '';
    renderChat();
  }

  async function toggleChatArchive(id, action) {
    try {
      await api('/api/chat/' + encodeURIComponent(id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action })
      });
      toast(action === 'archive' ? 'Conversa arquivada.' : 'Conversa reaberta.');
      await refreshChat(true);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function openChatForm() {
    var role = window.orivaCurrentActor && window.orivaCurrentActor.role;
    var admin = role === 'super_admin' || role === 'socio';
    window.orivaShowModal(window.orivaModalHead(role === 'empresa_cliente' ? 'Nova conversa com a Óriva' : (admin ? 'Nova conversa' : 'Nova dúvida para os sócios')) +
      '<div class="modal-body"><div class="loading-state"><div class="spinner"></div>Preparando formulário...</div></div>', false);
    try {
      var requests = [api('/api/companies')];
      if (role !== 'empresa_cliente') requests.push(api('/api/tasks'));
      var values = await Promise.all(requests);
      var companies = values[0].companies || [];
      var tasks = values[1] ? values[1].tasks || [] : [];
      renderChatForm(companies, tasks);
    } catch (error) {
      var root = document.getElementById('management-modal-root');
      if (root) root.querySelector('.modal-body').innerHTML = '<div class="management-inline-empty">' + esc(error.message) + '</div>';
    }
  }

  function selectOptions(items, valueKey, labelBuilder, placeholder) {
    return '<option value="">' + esc(placeholder) + '</option>' + items.map(function (item) {
      return '<option value="' + esc(item[valueKey]) + '">' + esc(labelBuilder(item)) + '</option>';
    }).join('');
  }

  function renderChatForm(companies, tasks) {
    var root = document.getElementById('management-modal-root');
    if (!root) return;
    var role = window.orivaCurrentActor && window.orivaCurrentActor.role;
    var admin = role === 'super_admin' || role === 'socio';
    var client = role === 'empresa_cliente';
    var types = client
      ? [{ value: 'mensagem', label: 'Conversa' }, { value: 'nova_demanda', label: 'Solicitar nova demanda' }]
      : admin
        ? [{ value: 'mensagem', label: 'Conversa' }, { value: 'duvida_demanda', label: 'Dúvida sobre demanda' }, { value: 'nova_demanda', label: 'Nova demanda do cliente' }]
        : [{ value: 'duvida_demanda', label: 'Dúvida sobre demanda' }, { value: 'mensagem', label: 'Conversa' }];
    var selectableParticipants = chatState.participants.filter(function (item) { return !item.automatic; });
    var participantChoices = selectableParticipants.length
      ? selectableParticipants.map(function (item) {
        return '<label class="chat-participant-choice"><input type="checkbox" name="participantIds" value="' + esc(item.id) + '"><span><strong>' + esc(item.name) + '</strong><small>' + esc(item.roleLabel) + '</small></span></label>';
      }).join('')
      : '<div class="management-inline-empty">Nenhuma outra pessoa com acesso ativo.</div>';
    var participantField = admin ? '<div class="field span-2"><label>Adicionar pessoas ao grupo</label><p class="field-help">Marque uma ou mais pessoas. Os três sócios abaixo já participam automaticamente.</p><div class="chat-participant-grid">' + participantChoices + '</div></div>' : '';
    var companyField = client ? '' : window.orivaField('Empresa relacionada (opcional)', '<select name="companyId">' + selectOptions(companies, 'id', function (item) { return item.name; }, 'Sem empresa específica') + '</select>');
    var taskField = tasks.length ? window.orivaField('Demanda relacionada (opcional)', '<select name="relatedTaskId">' + selectOptions(tasks, 'id', function (item) { return item.title + (item.companyName ? ' · ' + item.companyName : ''); }, 'Sem demanda específica') + '</select>') : '';
    root.querySelector('.modal').innerHTML = window.orivaModalHead(client ? 'Nova conversa com a Óriva' : (admin ? 'Nova conversa' : 'Nova dúvida para os sócios')) +
      '<form onsubmit="saveChatConversation(event)"><div class="modal-body"><div class="form-grid">' + participantField +
      window.orivaField('Tipo de conversa', '<select name="type" required>' + types.map(function (item) { return '<option value="' + item.value + '">' + esc(item.label) + '</option>'; }).join('') + '</select>') +
      companyField + taskField +
      window.orivaField('Assunto', '<input name="subject" maxlength="160" required placeholder="Ex.: Dúvida sobre as fotos da campanha">', true) +
      window.orivaField('Mensagem', '<textarea name="message" rows="5" maxlength="5000" required placeholder="Escreva os detalhes para a equipe..."></textarea>', true) +
      '</div><div class="chat-auto-mentions"><strong>Sócios mencionados automaticamente</strong><span>' + esc(chatState.automaticRecipientNames.join(', ')) + '</span></div>' +
      '<div class="chat-privacy-note"><strong>Conversa protegida</strong><span>' + (admin ? 'Você pode adicionar várias pessoas à equipe. Clientes nunca são colocados em grupos com outros clientes, colaboradores ou parceiros.' : 'Somente você e os sócios da Óriva terão acesso. Clientes não conversam com parceiros ou colaboradores.') + '</span></div></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="closeManagementModal()">Cancelar</button><button class="btn btn-primary" type="submit">Iniciar conversa</button></div></form>';
  }

  async function saveChatConversation(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var formData = new FormData(form);
    var data = Object.fromEntries(formData.entries());
    data.participantIds = formData.getAll('participantIds');
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Criando conversa...';
    try {
      var result = await api('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      closeManagementModal();
      chatState.selectedId = result.conversationId;
      toast('Conversa iniciada com sucesso.');
      await refreshChat(true);
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
      button.textContent = 'Iniciar conversa';
    }
  }

  async function refreshChat(keepThread) {
    if (chatState.refreshPromise) return chatState.refreshPromise;
    chatState.refreshPromise = loadChat(true, keepThread);
    try {
      await chatState.refreshPromise;
    } finally {
      chatState.refreshPromise = null;
    }
  }

  function startChatPolling() {
    if (chatState.polling) return;
    chatState.polling = window.setInterval(function () {
      if (document.getElementById('chat-area') && !document.hidden) refreshChat(true);
    }, 10000);
  }

  function stopChatPolling() {
    if (chatState.polling) window.clearInterval(chatState.polling);
    chatState.polling = null;
  }

  window.loadChat = loadChat;
  window.setChatFilter = setChatFilter;
  window.openChatConversation = openChatConversation;
  window.closeChatThread = closeChatThread;
  window.sendChatMessage = sendChatMessage;
  window.saveChatDraft = saveChatDraft;
  window.toggleChatArchive = toggleChatArchive;
  window.openChatForm = openChatForm;
  window.saveChatConversation = saveChatConversation;
  window.stopChatPolling = stopChatPolling;

  var style = document.createElement('style');
  style.textContent = '\
    .chat-page-head{align-items:flex-start}.chat-filters{display:flex;gap:8px;overflow-x:auto;padding:0 0 12px;scrollbar-width:thin}.chat-filter{border:1px solid var(--cinza-borda);background:#fff;border-radius:999px;padding:8px 13px;color:var(--texto-sec);font-weight:700;white-space:nowrap;cursor:pointer}.chat-filter.active{background:var(--roxo);border-color:var(--roxo);color:#fff}.chat-layout{height:min(690px,calc(100vh - 205px));min-height:520px;display:grid;grid-template-columns:360px minmax(0,1fr);overflow:hidden;background:#fff;border:1px solid var(--cinza-borda);border-radius:18px;box-shadow:var(--shadow)}.chat-list-panel{overflow-y:auto;border-right:1px solid var(--cinza-borda);background:#fbfcfe}.chat-conversation{position:relative;width:100%;display:flex;flex-direction:column;gap:6px;border:0;border-bottom:1px solid var(--cinza-borda);background:transparent;padding:16px;text-align:left;cursor:pointer;color:inherit}.chat-conversation:hover,.chat-conversation.active{background:#f3f0ff}.chat-conversation.active:before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--roxo)}.chat-conversation-top,.chat-conversation-bottom{display:flex;justify-content:space-between;gap:10px;align-items:center}.chat-conversation-top strong{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-conversation-top time{font-size:11px;color:var(--texto-muted);white-space:nowrap}.chat-conversation-meta{font-size:12px;color:var(--roxo);font-weight:700}.chat-conversation-bottom>span{font-size:12px;color:var(--texto-sec);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-unread{display:grid;place-items:center;min-width:21px;height:21px;border-radius:99px;background:var(--roxo);color:#fff;font-size:11px;padding:0 6px}.chat-demand-badge{align-self:flex-start;border-radius:6px;background:#fff3d7;color:#915c00;font-size:10px;font-weight:800;font-style:normal;padding:4px 7px}.chat-thread-panel{min-width:0;display:flex;flex-direction:column;background:#fff}.chat-thread-head{min-height:73px;display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--cinza-borda)}.chat-thread-head>div{min-width:0;flex:1}.chat-thread-head h2{font-size:16px;margin:0 0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-thread-head p{font-size:12px;color:var(--texto-sec);margin:0}.chat-back-button{display:none;border:0;background:var(--roxo-claro);color:var(--roxo);width:36px;height:36px;border-radius:10px;font-size:28px;cursor:pointer}.chat-context{display:flex;gap:8px;padding:9px 18px;border-bottom:1px solid var(--cinza-borda);overflow-x:auto}.chat-context span{border-radius:7px;background:#f3f5f8;padding:5px 8px;font-size:11px;color:var(--texto-sec);white-space:nowrap}.chat-messages{flex:1;overflow-y:auto;padding:20px;background:linear-gradient(180deg,#fbfcff,#f7f8fb)}.chat-message{display:flex;margin:0 0 12px}.chat-message.own{justify-content:flex-end}.chat-bubble{max-width:min(74%,620px);background:#fff;border:1px solid var(--cinza-borda);border-radius:4px 15px 15px 15px;padding:11px 13px;box-shadow:0 3px 12px rgba(15,23,42,.04)}.chat-message.own .chat-bubble{background:var(--roxo);border-color:var(--roxo);color:#fff;border-radius:15px 4px 15px 15px}.chat-bubble b{display:block;font-size:11px;margin-bottom:5px;color:var(--roxo)}.chat-message.own .chat-bubble b,.chat-message.own .chat-bubble time{color:rgba(255,255,255,.8)}.chat-bubble p{margin:0;line-height:1.48;overflow-wrap:anywhere}.chat-bubble time{display:block;text-align:right;color:var(--texto-muted);font-size:10px;margin-top:6px}.chat-composer{display:flex;align-items:flex-end;gap:10px;padding:14px;border-top:1px solid var(--cinza-borda);background:#fff}.chat-composer textarea{flex:1;resize:none;min-height:48px;max-height:130px}.chat-thread-empty,.chat-list-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;color:var(--texto-sec)}.chat-thread-empty h3,.chat-list-empty strong{color:var(--texto);margin:10px 0 5px}.chat-thread-empty p,.chat-list-empty span{max-width:420px;margin:0;line-height:1.5}.chat-list-empty .btn{margin-top:16px}.chat-empty-icon{width:52px;height:52px;padding:13px;border-radius:16px;color:var(--roxo);background:var(--roxo-claro)}.chat-empty-icon svg{width:100%;height:100%}.chat-archived-note{padding:14px;text-align:center;background:#f5f6f8;color:var(--texto-sec);font-size:13px;border-top:1px solid var(--cinza-borda)}.chat-participant-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-height:230px;overflow-y:auto;padding:3px}.chat-participant-choice{display:flex;align-items:center;gap:10px;border:1px solid var(--cinza-borda);border-radius:11px;padding:10px 11px;cursor:pointer;background:#fff}.chat-participant-choice:has(input:checked){border-color:var(--roxo);background:#f7f4ff}.chat-participant-choice input{width:18px;height:18px;accent-color:var(--roxo)}.chat-participant-choice span{display:flex;min-width:0;flex-direction:column}.chat-participant-choice strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-participant-choice small{font-size:11px;color:var(--texto-sec)}.chat-auto-mentions{display:flex;flex-direction:column;gap:5px;border:1px solid #cfe8dc;background:#f2fbf7;border-radius:12px;padding:12px 14px;margin-top:16px}.chat-auto-mentions strong{font-size:12px;color:#14734a}.chat-auto-mentions span{font-size:13px;font-weight:700;color:#174f3b}.chat-privacy-note{display:flex;gap:10px;flex-direction:column;border:1px solid #ddd4ff;background:#f8f6ff;color:var(--texto-sec);border-radius:12px;padding:12px 14px;margin-top:10px}.chat-privacy-note strong{color:var(--roxo)}.chat-privacy-note span{font-size:12px;line-height:1.5}\
    @media(max-width:760px){.chat-page-head{display:flex;gap:12px}.chat-page-head .btn{width:100%}.chat-layout{height:calc(100dvh - 270px);min-height:460px;display:block;position:relative}.chat-list-panel,.chat-thread-panel{height:100%}.chat-thread-panel{display:none}.chat-layout.mobile-thread-open .chat-list-panel{display:none}.chat-layout.mobile-thread-open .chat-thread-panel{display:flex}.chat-back-button{display:grid;place-items:center}.chat-filters{padding-bottom:10px}.chat-conversation{padding:14px}.chat-bubble{max-width:88%}.chat-messages{padding:14px}.chat-composer{padding:10px}.chat-composer .btn{padding-inline:13px}.chat-participant-grid{grid-template-columns:1fr;max-height:260px}}\
  ';
  document.head.appendChild(style);
})();
