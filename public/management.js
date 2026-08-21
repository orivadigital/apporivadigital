(function () {
  'use strict';

  var state = {
    companies: [],
    partners: [],
    contracts: [],
    finance: [],
    financePeriod: '',
    delinquent: [],
    tasks: [],
    accesses: [],
    backups: [],
    restores: [],
    taskOptionsLoaded: false,
    agendaCursor: new Date(),
    companyCalendarCursor: new Date(),
    companyCalendarEvents: [],
    companyCalendarCompanies: [],
    companyCalendarId: '',
    commercialOwners: [],
    companyRelationshipFilter: 'todos',
    leadDisplay: 'funil',
    canManageAccess: false,
    session: null,
    loginInProgress: false
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function translateMessage(value, fallback) {
    var message = String(value || '').trim();
    var standard = fallback || 'Não foi possível concluir a operação.';
    var translations = [
      [/email not confirmed/i, 'E-mail não confirmado. Abra o link de confirmação enviado para o seu e-mail e tente novamente.'],
      [/invalid (login )?credentials/i, 'E-mail ou senha incorretos.'],
      [/user not found/i, 'Usuário não encontrado.'],
      [/email rate limit exceeded|too many.*email/i, 'Muitos e-mails foram solicitados em pouco tempo. Aguarde alguns minutos e tente novamente.'],
      [/token.*expired|expired.*token|otp.*expired/i, 'Este link ou código expirou. Solicite um novo e tente novamente.'],
      [/failed to fetch|fetch failed|network request failed|load failed/i, 'Não foi possível conectar ao sistema. Verifique sua internet e tente novamente.'],
      [/row-level security|permission denied|insufficient permissions|unauthorized|forbidden/i, 'Você não tem permissão para realizar esta ação.']
    ];
    for (var index = 0; index < translations.length; index += 1) {
      if (translations[index][0].test(message)) return translations[index][1];
    }
    return message || standard;
  }

  async function api(url, options, retried) {
    var response;
    try {
      response = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}));
    } catch (error) {
      throw new Error(translateMessage(error && error.message, 'Não foi possível conectar ao sistema. Verifique sua internet e tente novamente.'));
    }
    if (response.status === 401 && !retried && url.indexOf('/api/auth/') !== 0) {
      var refreshed = await window.orivaRefreshSession();
      if (refreshed.ok) return api(url, options, true);
    }
    var payload = {};
    var text = '';
    try {
      payload = await response.json();
    } catch (error) {
      try { text = await response.text(); } catch (ignored) { text = ''; }
    }
    if (!response.ok) {
      var failure = new Error(translateMessage(payload.error || text, 'Não foi possível concluir a operação.'));
      failure.status = response.status;
      throw failure;
    }
    return payload;
  }

  function money(cents) {
    return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL'
    });
  }

  function cents(value) {
    var normalized = String(value || '').replace(/\./g, '').replace(',', '.');
    return Math.round((Number(normalized) || 0) * 100);
  }

  function formatFileSize(bytes) {
    var value = Number(bytes || 0);
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1).replace('.', ',') + ' KB';
    if (value < 1073741824) return (value / 1048576).toFixed(1).replace('.', ',') + ' MB';
    if (value < 1099511627776) return (value / 1073741824).toFixed(2).replace('.', ',') + ' GB';
    return (value / 1099511627776).toFixed(2).replace('.', ',') + ' TB';
  }

  function dateBR(value) {
    if (!value) return 'Sem data';
    var parts = String(value).split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value;
  }

  var leadStages = [
    { value: 'novo', label: 'Novo lead' },
    { value: 'contato_realizado', label: 'Contato realizado' },
    { value: 'proposta_enviada', label: 'Proposta enviada' },
    { value: 'negociacao', label: 'Negociação' },
    { value: 'ganho', label: 'Ganho' },
    { value: 'perdido', label: 'Perdido' }
  ];

  function leadStageLabel(value) {
    var match = leadStages.find(function (stage) { return stage.value === value; });
    return match ? match.label : 'Novo lead';
  }

  function dateTimeBR(value) {
    if (!value) return 'Não agendado';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Não agendado';
    return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function dateTimeLocalValue(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function initials(value) {
    return String(value || '?').trim().split(/\s+/).map(function (part) {
      return part.charAt(0);
    }).join('').slice(0, 2).toUpperCase();
  }

  function options(items, selected, placeholder) {
    var html = placeholder == null ? '' : '<option value="">' + esc(placeholder) + '</option>';
    return html + items.map(function (item) {
      var value = typeof item === 'string' ? item : item.value;
      var label = typeof item === 'string' ? item : item.label;
      return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function field(label, control, full, hint) {
    return '<label class="field' + (full ? ' full' : '') + '"><span>' + esc(label) + '</span>' +
      control + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  }

  function modalHead(title) {
    return '<div class="modal-head"><h2>' + esc(title) + '</h2>' +
      '<button class="modal-close" aria-label="Fechar" onclick="closeManagementModal()">×</button></div>';
  }

  function showModal(html, large) {
    closeManagementModal();
    var root = document.createElement('div');
    root.id = 'management-modal-root';
    root.className = 'modal-backdrop';
    root.innerHTML = '<div class="modal' + (large ? ' modal-lg' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    root.addEventListener('click', function (event) {
      if (event.target === root) closeManagementModal();
    });
    document.body.appendChild(root);
  }

  function closeManagementModal() {
    var root = document.getElementById('management-modal-root');
    if (root) root.remove();
    if (window.pendingClientCredentials) window.pendingClientCredentials = '';
  }
  window.closeManagementModal = closeManagementModal;

  function toast(message, error) {
    var el = document.createElement('div');
    el.className = 'content-toast' + (error ? ' error' : '');
    el.textContent = message;
    document.body.appendChild(el);
    window.setTimeout(function () { el.classList.add('show'); }, 10);
    window.setTimeout(function () { el.remove(); }, 3400);
  }

  function loading(id, label) {
    return '<div id="' + id + '"><div class="loading-state"><div class="spinner"></div>' + esc(label) + '</div></div>';
  }

  function empty(title, description, action) {
    return '<div class="card management-empty"><div class="empty-icon">' + ico.agenda + '</div>' +
      '<h3>' + esc(title) + '</h3><p>' + esc(description) + '</p>' + (action || '') + '</div>';
  }

  function currentActorRole() {
    return state.session && state.session.actor ? state.session.actor.role : '';
  }

  function canManageAgencyTasks() {
    return currentActorRole() === 'super_admin' || currentActorRole() === 'socio';
  }

  function applySession(payload) {
    state.session = payload;
    perfilAtual = payload.profile;
    var actor = payload.actor;
    window.orivaCurrentActor = actor;
    state.companyCalendarId = actor.role === 'empresa_cliente' ? (actor.companyId || '') : '';
    var name = actor.name || actor.email.split('@')[0];
    document.getElementById('u-nome').textContent = name;
    var roles = { super_admin: 'Administrador principal', socio: 'Sócio', colaborador: 'Colaborador', empresa_cliente: 'Cliente', parceiro: 'Parceiro PJ' };
    document.getElementById('u-papel').textContent = roles[actor.role] || 'Usuário';
    document.getElementById('u-avatar').textContent = initials(name);
    document.getElementById('tela-login').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    montarNav();
    irPara(perfilAtual === 'cliente' ? 'c-dashboard' : perfilAtual === 'parceiro' ? 'p-dashboard' : 'dashboard');
    window.scrollTo(0, 0);
  }

  async function entrar() {
    var status = document.getElementById('login-status');
    var button = document.getElementById('login-button');
    var email = document.getElementById('login-email').value.trim();
    var password = document.getElementById('login-password').value;
    if (!email || !password) { if (status) status.textContent = 'Informe seu e-mail e sua senha.'; return; }
    if (state.loginInProgress) return;
    state.loginInProgress = true;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Entrando...';
    }
    if (status) status.textContent = 'Entrando na sua conta...';
    try {
      var payload = await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password }) });
      applySession(payload);
      document.getElementById('login-password').value = '';
    } catch (error) {
      if (status) status.textContent = error.message;
      toast(error.message, true);
    } finally {
      state.loginInProgress = false;
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = 'Entrar na plataforma';
      }
    }
  }

  function setLoginView(view) {
    var loginFields = ['.login-card > .secure-login-note', '.login-card > .login-label', '.login-card > .login-label-row', '#login-email', '#login-password', '.login-card > .btn-login', '#login-status'];
    loginFields.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (element) {
        element.classList.toggle('hidden', view !== 'login');
      });
    });
    var forgot = document.getElementById('forgot-password-view');
    var reset = document.getElementById('reset-password-view');
    var bootstrap = document.getElementById('bootstrap-owner-button');
    if (forgot) forgot.classList.toggle('hidden', view !== 'forgot');
    if (reset) reset.classList.toggle('hidden', view !== 'reset');
    if (bootstrap) bootstrap.style.display = view === 'login' ? '' : 'none';
  }

  function setRecoveryMessage(id, message, kind) {
    var element = document.getElementById(id);
    if (!element) return;
    element.textContent = message || '';
    element.className = 'login-message' + (kind ? ' ' + kind : '') + (message ? '' : ' hidden');
  }

  function showLoginForm() {
    setLoginView('login');
    setRecoveryMessage('recovery-status', '', '');
    setRecoveryMessage('new-password-status', '', '');
    var password = document.getElementById('login-password');
    if (password) password.value = '';
    var email = document.getElementById('login-email');
    if (email) email.focus();
  }

  function openForgotPassword(message) {
    setLoginView('forgot');
    var loginEmail = document.getElementById('login-email');
    var recoveryEmail = document.getElementById('recovery-email');
    if (recoveryEmail) {
      if (!recoveryEmail.value && loginEmail) recoveryEmail.value = loginEmail.value.trim();
      recoveryEmail.focus();
    }
    setRecoveryMessage('recovery-status', message || '', message ? 'error' : '');
  }

  async function sendPasswordReset(event) {
    event.preventDefault();
    var email = document.getElementById('recovery-email').value.trim();
    var button = document.getElementById('send-recovery-button');
    if (!email) {
      setRecoveryMessage('recovery-status', 'Informe o e-mail usado para entrar na plataforma.', 'error');
      return;
    }
    button.disabled = true;
    button.textContent = 'Enviando link...';
    setRecoveryMessage('recovery-status', '', '');
    try {
      await api('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      setRecoveryMessage('recovery-status', 'Se este e-mail estiver cadastrado, o link foi enviado. Confira também a caixa de spam e use o link assim que recebê-lo.', 'success');
      button.textContent = 'Enviar novamente';
    } catch (error) {
      setRecoveryMessage('recovery-status', error.message, 'error');
      button.textContent = 'Tentar novamente';
    } finally {
      button.disabled = false;
    }
  }

  function openPasswordRecoveryFromUrl() {
    var hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    var search = new URLSearchParams(window.location.search);
    var isRecovery = hash.get('type') === 'recovery' || search.get('password-recovery') === '1';
    var accessToken = hash.get('access_token');
    if (!isRecovery && !hash.get('error')) return false;

    document.getElementById('app').classList.add('hidden');
    document.getElementById('tela-login').classList.remove('hidden');
    if (accessToken && hash.get('type') === 'recovery') {
      window.orivaRecoveryToken = accessToken;
      window.history.replaceState({}, document.title, '/oriva-plataforma.html?password-recovery=1');
      setLoginView('reset');
      window.setTimeout(function () { document.getElementById('new-password').focus(); }, 0);
      return true;
    }

    window.history.replaceState({}, document.title, '/oriva-plataforma.html');
    openForgotPassword('Este link de recuperação é inválido, já foi utilizado ou expirou. Solicite um novo link.');
    return true;
  }

  async function saveNewPassword(event) {
    event.preventDefault();
    var password = document.getElementById('new-password').value;
    var confirmation = document.getElementById('confirm-new-password').value;
    var button = document.getElementById('save-password-button');
    if (password.length < 8) {
      setRecoveryMessage('new-password-status', 'A nova senha precisa ter pelo menos 8 caracteres.', 'error');
      return;
    }
    if (password !== confirmation) {
      setRecoveryMessage('new-password-status', 'As duas senhas não são iguais. Digite novamente.', 'error');
      return;
    }
    if (!window.orivaRecoveryToken) {
      openForgotPassword('O link perdeu a validade. Solicite um novo link de recuperação.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Salvando nova senha...';
    setRecoveryMessage('new-password-status', '', '');
    try {
      await api('/api/auth/update-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + window.orivaRecoveryToken
        },
        body: JSON.stringify({ password: password })
      });
      window.orivaRecoveryToken = '';
      window.history.replaceState({}, document.title, '/oriva-plataforma.html');
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-new-password').value = '';
      showLoginForm();
      document.getElementById('login-status').textContent = 'Senha alterada com sucesso. Entre usando sua nova senha.';
      toast('Sua senha foi alterada com sucesso.');
    } catch (error) {
      setRecoveryMessage('new-password-status', error.message, 'error');
      button.disabled = false;
      button.textContent = 'Salvar nova senha';
    }
  }

  async function sair() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (ignored) {}
    if (typeof window.closeMobileNav === 'function') window.closeMobileNav();
    state.session = null;
    window.orivaCurrentActor = null;
    document.getElementById('app').classList.add('hidden');
    document.getElementById('tela-login').classList.remove('hidden');
    document.getElementById('login-password').value = '';
    document.getElementById('login-status').textContent = 'Entre com o e-mail e a senha cadastrados pela Óriva.';
  }

  function showRestrictedAreaMessage() {
    toast('Esta área é restrita ao administrador principal e aos sócios.', true);
  }
  window.showRestrictedAreaMessage = showRestrictedAreaMessage;

  async function voltarAoLogin() {
    document.getElementById('account-menu').classList.add('hidden');
    await sair();
  }

  async function restoreSession() {
    try { applySession(await api('/api/session')); return; } catch (ignored) {}
    try {
      var status = await api('/api/auth/bootstrap-status');
      var button = document.getElementById('bootstrap-owner-button');
      if (button) button.classList.toggle('hidden', !!status.configured);
    } catch (ignored) {}
  }

  function openBootstrapOwner() {
    var html = modalHead('Configurar proprietário da Óriva') + '<form onsubmit="bootstrapOwner(event)"><div class="modal-body"><div class="form-grid">' +
      field('Seu nome completo', '<input name="name" required autocomplete="name" placeholder="Nome do proprietário">') +
      field('E-mail do proprietário', '<input name="email" type="email" required autocomplete="email" placeholder="proprietario@empresa.com">') +
      field('Crie sua senha', '<input name="password" type="password" minlength="8" required autocomplete="new-password">', false, 'Use pelo menos 8 caracteres. A senha fica somente no Supabase Auth.') +
      '</div></div><div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button type="submit" class="btn btn-primary">Criar minha conta</button></div></form>';
    showModal(html, false);
  }

  async function bootstrapOwner(event) {
    event.preventDefault(); var form = event.currentTarget; var data = Object.fromEntries(new FormData(form).entries()); var button = form.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Criando conta...';
    try { await api('/api/auth/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); closeManagementModal(); applySession(await api('/api/session')); toast('Conta do proprietário criada com segurança.'); } catch (error) { toast(error.message, true); button.disabled = false; button.textContent = 'Criar minha conta'; }
  }

  function toggleAccountMenu(event) {
    if (event) event.stopPropagation();
    document.getElementById('account-menu').classList.toggle('hidden');
  }

  function filterCurrentPage(value) {
    var query = String(value || '').trim().toLowerCase();
    document.querySelectorAll('[data-search]').forEach(function (item) {
      item.style.display = !query || item.dataset.search.toLowerCase().includes(query) ? '' : 'none';
    });
  }

  window.entrar = entrar;
  window.openForgotPassword = openForgotPassword;
  window.showLoginForm = showLoginForm;
  window.sendPasswordReset = sendPasswordReset;
  window.saveNewPassword = saveNewPassword;
  window.sair = sair;
  window.voltarAoLogin = voltarAoLogin;
  window.openBootstrapOwner = openBootstrapOwner;
  window.bootstrapOwner = bootstrapOwner;
  window.toggleAccountMenu = toggleAccountMenu;
  window.filterCurrentPage = filterCurrentPage;
  window.orivaApi = api;
  window.orivaToast = toast;
  window.orivaEscape = esc;
  window.orivaShowModal = showModal;
  window.orivaModalHead = modalHead;
  window.orivaField = field;
  window.orivaEmpty = empty;
  document.addEventListener('click', function () {
    var menu = document.getElementById('account-menu');
    if (menu) menu.classList.add('hidden');
  });
  window.setTimeout(function () {
    if (!openPasswordRecoveryFromUrl()) restoreSession();
  }, 0);

  paginas.clientes = function () {
    window.setTimeout(loadCompanies, 0);
    return '<div class="page-head"><div><h1 class="page-title">Empresas e leads</h1>' +
      '<p class="page-desc">Gerencie clientes ativos e acompanhe potenciais clientes em um funil comercial</p></div>' +
      '<button id="new-company-button" class="btn btn-primary" onclick="openCompanyForm()">+ Novo cadastro</button></div>' +
      loading('companies-area', 'Carregando empresas...');
  };

  async function loadCompanies() {
    var area = document.getElementById('companies-area');
    if (!area) return;
    try {
      var payload = await api('/api/companies');
      state.companies = payload.companies || [];
      state.commercialOwners = payload.commercialOwners || [];
      var createButton = document.getElementById('new-company-button');
      if (createButton) createButton.style.display = state.session && state.session.canManageCompanies ? '' : 'none';
      if (!state.companies.length) {
        area.innerHTML = empty('Nenhuma empresa cadastrada', 'Cadastre a primeira empresa para criar seu calendário e acesso.', state.session && state.session.canManageCompanies ? '<button class="btn btn-primary" onclick="openCompanyForm()">Criar primeira empresa</button>' : '');
        return;
      }
      renderCompaniesArea();
    } catch (error) {
      area.innerHTML = empty('Não foi possível carregar as empresas', error.message, '<button class="btn btn-primary" onclick="loadCompanies()">Tentar novamente</button>');
    }
  }
  window.loadCompanies = loadCompanies;

  function followUpBadge(company) {
    if (!company.nextFollowUpAt) return '<span class="follow-up-badge neutral">Não agendado</span>';
    var date = new Date(company.nextFollowUpAt);
    var now = new Date();
    var expired = date.getTime() < now.getTime();
    var soon = !expired && date.getTime() - now.getTime() < 86400000;
    return '<span class="follow-up-badge ' + (expired ? 'overdue' : soon ? 'soon' : '') + '">' + esc(dateTimeBR(company.nextFollowUpAt)) + '</span>';
  }

  function companyToolbar() {
    var clients = state.companies.filter(function (company) { return company.relationshipType === 'Cliente'; }).length;
    var leads = state.companies.filter(function (company) { return company.relationshipType === 'Lead'; }).length;
    var filter = state.companyRelationshipFilter;
    return '<div class="crm-summary"><button class="crm-filter-card ' + (filter === 'todos' ? 'active' : '') + '" onclick="setCompanyRelationshipFilter(\'todos\')"><b>' + state.companies.length + '</b><span>Todos os cadastros</span></button>' +
      '<button class="crm-filter-card ' + (filter === 'Cliente' ? 'active' : '') + '" onclick="setCompanyRelationshipFilter(\'Cliente\')"><b>' + clients + '</b><span>Clientes</span></button>' +
      '<button class="crm-filter-card ' + (filter === 'Lead' ? 'active' : '') + '" onclick="setCompanyRelationshipFilter(\'Lead\')"><b>' + leads + '</b><span>Leads</span></button></div>' +
      '<div class="content-toolbar crm-toolbar"><div class="crm-tabs"><button class="' + (filter === 'todos' ? 'active' : '') + '" onclick="setCompanyRelationshipFilter(\'todos\')">Todos</button><button class="' + (filter === 'Cliente' ? 'active' : '') + '" onclick="setCompanyRelationshipFilter(\'Cliente\')">Clientes</button><button class="' + (filter === 'Lead' ? 'active' : '') + '" onclick="setCompanyRelationshipFilter(\'Lead\')">Leads</button></div>' +
      (filter === 'Lead' ? '<div class="crm-view-switch"><button class="' + (state.leadDisplay === 'funil' ? 'active' : '') + '" onclick="setLeadDisplay(\'funil\')">Funil</button><button class="' + (state.leadDisplay === 'lista' ? 'active' : '') + '" onclick="setLeadDisplay(\'lista\')">Lista</button></div>' : '') +
      '<span class="toolbar-note">Use os filtros para encontrar rapidamente clientes ou potenciais clientes.</span></div>';
  }

  function renderCompanyTable(companies) {
    if (!companies.length) return empty('Nenhum cadastro neste filtro', 'Cadastre um novo cliente ou lead para começar.', '<button class="btn btn-primary" onclick="openCompanyForm()">Novo cadastro</button>');
    return '<div class="tbl-wrap"><table><thead><tr><th>Empresa</th><th>Classificação</th><th>Etapa / situação</th><th>Contato</th><th>Responsável</th><th>Próximo contato</th><th>Ações</th></tr></thead><tbody>' + companies.map(function (company) {
      var isLead = company.relationshipType === 'Lead';
      var stage = isLead ? leadStageLabel(company.leadStage) : company.status;
      var owner = isLead ? (company.leadOwnerName || 'Não definido') : (company.responsible || 'Não definido');
      var actions = isLead
        ? '<button class="btn btn-primary btn-compact" onclick="openLeadDetails(\'' + esc(company.id) + '\')">Acompanhar</button><button class="btn btn-ghost btn-compact" onclick="openCompanyForm(\'' + esc(company.id) + '\')">Editar</button>'
        : '<button class="btn btn-ghost btn-compact" onclick="abrirCalendarioGeralEmpresa(\'' + esc(company.id) + '\')">Calendário</button><button class="btn btn-ghost btn-compact" onclick="abrirCalendarioEmpresa(\'' + esc(company.id) + '\')">Posts</button><button class="btn btn-ghost btn-compact" onclick="openCompanyForm(\'' + esc(company.id) + '\')">Editar</button>';
      return '<tr data-search="' + esc([company.name, company.contactEmail, company.phone, company.whatsapp, company.leadSource, owner, stage].join(' ')) + '">' +
        '<td><div class="td-nome"><div class="avatar-sm" style="background:' + (isLead ? 'var(--amarelo)' : 'var(--roxo)') + '">' + esc(initials(company.name)) + '</div><div>' + esc(company.name) + '<div class="li-sub">' + esc(company.segment || 'Segmento não informado') + '</div></div></div></td>' +
        '<td><span class="tag ' + (isLead ? 'tag-amarelo' : 'tag-verde') + '">' + esc(company.relationshipType) + '</span></td>' +
        '<td><span class="lead-stage-pill stage-' + esc(company.leadStage || 'cliente') + '">' + esc(stage) + '</span></td>' +
        '<td><b style="font-size:12px">' + esc(company.contactEmail || 'Não informado') + '</b><div class="li-sub">' + esc(company.whatsapp || company.phone || 'Sem telefone') + '</div></td>' +
        '<td>' + esc(owner) + '<div class="li-sub">' + esc(isLead ? (company.leadSource || 'Origem não informada') : (company.responsibleEmail || '')) + '</div></td>' +
        '<td>' + (isLead ? followUpBadge(company) : '<span class="li-sub">—</span>') + '</td><td><div class="management-actions">' + actions + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  function renderLeadPipeline(leads) {
    return '<div class="lead-pipeline" aria-label="Funil comercial de leads">' + leadStages.map(function (stage) {
      var items = leads.filter(function (lead) { return (lead.leadStage || 'novo') === stage.value; });
      return '<section class="lead-column stage-' + stage.value + '"><div class="lead-column-head"><div><span class="lead-stage-dot"></span><b>' + esc(stage.label) + '</b></div><span>' + items.length + '</span></div><div class="lead-column-body">' +
        (items.length ? items.map(function (lead) {
          return '<article class="lead-card" data-search="' + esc([lead.name, lead.contactEmail, lead.whatsapp, lead.leadSource, lead.leadOwnerName].join(' ')) + '"><div class="lead-card-top"><span>' + esc(lead.leadSource || 'Origem não informada') + '</span><button aria-label="Editar lead" onclick="openCompanyForm(\'' + esc(lead.id) + '\')">•••</button></div><h3>' + esc(lead.name) + '</h3><p>' + esc(lead.contactEmail || lead.whatsapp || 'Contato não informado') + '</p><div class="lead-card-meta"><span>Próximo contato</span>' + followUpBadge(lead) + '</div><div class="lead-card-footer"><span>' + esc(lead.leadOwnerName || 'Sem responsável') + '</span><button class="btn btn-primary btn-compact" onclick="openLeadDetails(\'' + esc(lead.id) + '\')">Abrir</button></div></article>';
        }).join('') : '<div class="lead-column-empty">Nenhum lead nesta etapa.</div>') + '</div></section>';
    }).join('') + '</div>';
  }

  function renderCompaniesArea() {
    var area = document.getElementById('companies-area');
    if (!area) return;
    var filter = state.companyRelationshipFilter;
    var companies = state.companies.filter(function (company) { return filter === 'todos' || company.relationshipType === filter; });
    area.innerHTML = companyToolbar() + (filter === 'Lead' && state.leadDisplay === 'funil' ? renderLeadPipeline(companies) : renderCompanyTable(companies));
    window.setTimeout(function () { if (window.enhanceResponsiveTables) window.enhanceResponsiveTables(area); }, 0);
  }

  function setCompanyRelationshipFilter(value) {
    state.companyRelationshipFilter = value;
    renderCompaniesArea();
  }
  window.setCompanyRelationshipFilter = setCompanyRelationshipFilter;

  function setLeadDisplay(value) {
    state.leadDisplay = value === 'lista' ? 'lista' : 'funil';
    renderCompaniesArea();
  }
  window.setLeadDisplay = setLeadDisplay;

  function openCompanyForm(id) {
    if (!state.session || !state.session.canManageCompanies) { toast('Seu acesso não permite cadastrar ou editar empresas.', true); return; }
    var company = state.companies.find(function (item) { return item.id === id; });
    var html = modalHead(company ? 'Editar empresa' : 'Cadastrar nova empresa') +
      '<form onsubmit="saveCompany(event,\'' + esc(id || '') + '\')"><div class="modal-body">' +
      '<section class="form-section"><div class="form-section-title">1. Dados da empresa</div><div class="form-section-desc">Informações usadas pela agência para identificar e organizar o cliente.</div><div class="form-grid">' +
        field('Nome da empresa', '<input name="name" required value="' + esc(company ? company.name : '') + '" placeholder="Ex.: Studio Bella">') +
        field('Nome fantasia', '<input name="tradeName" value="' + esc(company ? company.tradeName : '') + '" placeholder="Como a marca é conhecida">') +
        field('CNPJ / documento', '<input name="document" value="' + esc(company ? company.document : '') + '" placeholder="Opcional">') +
        field('Segmento', '<input name="segment" value="' + esc(company ? company.segment : '') + '" placeholder="Ex.: Estética, restaurante, varejo">') +
        field('Classificação comercial', '<select id="company-relationship-type" name="relationshipType" onchange="toggleLeadFields(this.value)">' + options(['Cliente', 'Lead'], company ? company.relationshipType : 'Cliente') + '</select>', false, 'Use Lead para potenciais clientes que ainda estão em negociação.') +
      '</div></section>' +
      '<section class="form-section"><div class="form-section-title">2. Login do cliente</div><div class="form-section-desc">O login será o e-mail abaixo. A senha será criada agora e não ficará salva em texto no sistema.</div><div class="form-grid">' +
        field('Nome do cliente responsável', '<input name="clientName" required value="' + esc(company ? company.name : '') + '" placeholder="Pessoa que receberá o acesso">') +
        field('E-mail usado como login', '<input name="contactEmail" type="email" required value="' + esc(company ? company.contactEmail : '') + '" placeholder="cliente@empresa.com" autocomplete="email">', false, 'Esse será exatamente o login do cliente.') +
        field(company ? 'Nova senha (opcional)' : 'Crie a senha do cliente', '<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="company-password" name="password" type="password" minlength="8" ' + (company ? '' : 'required') + ' autocomplete="new-password" style="flex:1;min-width:180px"><button type="button" class="btn btn-ghost" onclick="generateTemporaryPassword(\'company-password\')">Gerar senha segura</button></div>', true, company ? 'Preencha somente se quiser trocar a senha do cliente.' : 'Use pelo menos 8 caracteres. Depois de salvar, você poderá copiar o e-mail e a senha para enviar ao cliente.') +
      '</div></section>' +
      '<section class="form-section"><div class="form-section-title">3. Contato e atendimento</div><div class="form-section-desc">Informações internas para a equipe acompanhar esta conta.</div><div class="form-grid">' +
        field('Telefone', '<input name="phone" inputmode="tel" value="' + esc(company ? company.phone : '') + '" placeholder="(21) 99999-9999">') +
        field('WhatsApp', '<input name="whatsapp" inputmode="tel" value="' + esc(company ? company.whatsapp : '') + '" placeholder="(21) 99999-9999">') +
        field('Responsável interno', '<input name="responsible" value="' + esc(company ? company.responsible : '') + '" placeholder="Sócio responsável">') +
        field('E-mail do responsável', '<input name="responsibleEmail" type="email" value="' + esc(company ? company.responsibleEmail : '') + '" placeholder="responsavel@empresa.com">') +
        (company ? field('Situação', '<select name="status">' + options(['Ativo', 'Pausado', 'Bloqueado', 'Encerrado'], company.status) + '</select>') : '') +
        field('Serviços contratados', '<textarea name="services" placeholder="Redes sociais, site, edição de vídeos...">' + esc(company ? company.services : '') + '</textarea>', true) +
      '</div></section><section id="lead-commercial-fields" class="form-section' + (company && company.relationshipType === 'Lead' ? '' : ' hidden') + '"><div class="form-section-title">4. Acompanhamento comercial</div><div class="form-section-desc">Organize a negociação, o próximo contato e o histórico deste potencial cliente.</div><div class="form-grid">' +
        field('Etapa do funil', '<select name="leadStage">' + options(leadStages, company ? company.leadStage : 'novo') + '</select>') +
        field('Origem do lead', '<select name="leadSource">' + options(['Indicação', 'Instagram', 'WhatsApp', 'Site', 'Prospecção ativa', 'Google', 'Evento', 'Outro'], company ? company.leadSource : '', 'Selecione a origem') + '</select>') +
        field('Responsável comercial', '<select name="leadOwnerId">' + options(state.commercialOwners.map(function (owner) { return { value: owner.id, label: owner.name }; }), company ? company.leadOwnerId : '', 'Selecione o responsável') + '</select>') +
        field('Próximo contato', '<input name="nextFollowUpAt" type="datetime-local" value="' + esc(dateTimeLocalValue(company ? company.nextFollowUpAt : '')) + '">') +
        field('Último contato', '<input name="lastContactAt" type="datetime-local" value="' + esc(dateTimeLocalValue(company ? company.lastContactAt : '')) + '">') +
        field('Motivo da perda, se houver', '<input name="lostReason" value="' + esc(company ? company.lostReason : '') + '" placeholder="Ex.: orçamento, prazo, sem retorno">') +
        field('Anotações comerciais', '<textarea name="commercialNotes" placeholder="Contexto, necessidades, objeções e próximos passos...">' + esc(company ? company.commercialNotes : '') + '</textarea>', true) +
      '</div></section>' +
      '<div class="secure-login-note"><b>Login, empresa e calendário criados juntos</b><span>Ao salvar, o Supabase Auth cria a conta real e o banco vincula o calendário somente a esta empresa. O cliente nunca verá conteúdos de outra empresa.</span></div></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button class="btn btn-primary" type="submit">' + (company ? 'Salvar alterações' : 'Criar empresa e acesso') + '</button></div></form>';
    showModal(html, false);
  }
  window.openCompanyForm = openCompanyForm;

  function toggleLeadFields(value) {
    var section = document.getElementById('lead-commercial-fields');
    if (section) section.classList.toggle('hidden', value !== 'Lead');
  }
  window.toggleLeadFields = toggleLeadFields;

  function generateTemporaryPassword(inputId) {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'; var bytes = new Uint32Array(14); crypto.getRandomValues(bytes); var password = Array.from(bytes).map(function (value) { return alphabet[value % alphabet.length]; }).join(''); var input = document.getElementById(inputId); if (input) { input.value = password; input.type = 'text'; input.select(); }
  }
  window.generateTemporaryPassword = generateTemporaryPassword;

  function showCompanyCredentials(companyName, email, password) {
    var text = 'Acesso da ' + companyName + '\nLogin: ' + email + '\nSenha temporária: ' + password + '\nSite: https://app.orivadigital.com.br/oriva-plataforma.html';
    var html = modalHead('Empresa e acesso criados') + '<div class="modal-body"><div class="empty-icon">✓</div><div style="text-align:center"><h3 style="font-size:18px">Tudo pronto para o cliente entrar</h3><p class="page-desc" style="margin-top:5px">Copie os dados abaixo e envie por um canal seguro. A senha não será armazenada nesta tela depois que ela for fechada.</p></div>' +
      '<div class="credential-box"><div class="credential-row"><div class="credential-label">Empresa</div><div class="credential-value">' + esc(companyName) + '</div></div><div class="credential-row"><div class="credential-label">Login</div><div class="credential-value">' + esc(email) + '</div></div><div class="credential-row"><div class="credential-label">Senha</div><div class="credential-value">' + esc(password) + '</div></div></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Fechar</button><button type="button" class="btn btn-primary" id="copy-client-access" onclick="copyClientCredentials()">Copiar acesso</button></div></div>';
    showModal(html, false);
    window.pendingClientCredentials = text;
  }

  async function copyClientCredentials() {
    try {
      await navigator.clipboard.writeText(window.pendingClientCredentials || '');
      toast('Login e senha copiados.');
      var button = document.getElementById('copy-client-access');
      if (button) button.textContent = 'Acesso copiado ✓';
    } catch (error) {
      toast('Não foi possível copiar automaticamente. Selecione os dados exibidos.', true);
    }
  }
  window.copyClientCredentials = copyClientCredentials;

  async function saveCompany(event, id) {
    event.preventDefault();
    var form = event.currentTarget;
    var data = Object.fromEntries(new FormData(form).entries());
    ['nextFollowUpAt', 'lastContactAt'].forEach(function (key) {
      if (data[key]) data[key] = new Date(data[key]).toISOString();
    });
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Salvando...';
    try {
      await api(id ? '/api/companies/' + encodeURIComponent(id) : '/api/companies', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      closeManagementModal();
      if (data.relationshipType === 'Lead') state.companyRelationshipFilter = 'Lead';
      await loadCompanies();
      if (id) {
        toast('Empresa atualizada.');
      } else {
        showCompanyCredentials(data.name, data.contactEmail, data.password);
        toast('Empresa, calendário e acesso criados.');
      }
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
      button.textContent = id ? 'Salvar alterações' : 'Criar empresa e acesso';
    }
  }
  window.saveCompany = saveCompany;

  function openLeadDetails(id) {
    var lead = state.companies.find(function (company) { return company.id === id; });
    if (!lead) { toast('Lead não encontrado.', true); return; }
    var whatsapp = String(lead.whatsapp || lead.phone || '').replace(/\D/g, '');
    var html = modalHead('Acompanhamento do lead') + '<div class="modal-body"><div class="lead-detail-hero"><div class="lead-detail-brand"><div class="avatar-sm" style="background:var(--amarelo)">' + esc(initials(lead.name)) + '</div><div><span class="tag tag-amarelo">Lead</span><h3>' + esc(lead.name) + '</h3><p>' + esc(lead.contactEmail || 'E-mail não informado') + '</p></div></div><div class="management-actions">' +
      (whatsapp ? '<a class="btn btn-ghost" href="https://wa.me/55' + esc(whatsapp.replace(/^55/, '')) + '" target="_blank" rel="noopener">Abrir WhatsApp</a>' : '') + '<button class="btn btn-ghost" onclick="closeManagementModal();openCompanyForm(\'' + esc(id) + '\')">Editar cadastro</button></div></div>' +
      '<div class="lead-detail-grid"><div><span>Etapa atual</span><b>' + esc(leadStageLabel(lead.leadStage)) + '</b></div><div><span>Responsável</span><b>' + esc(lead.leadOwnerName || 'Não definido') + '</b></div><div><span>Próximo contato</span><b>' + esc(dateTimeBR(lead.nextFollowUpAt)) + '</b></div><div><span>Origem</span><b>' + esc(lead.leadSource || 'Não informada') + '</b></div></div>' +
      '<div class="commercial-note"><span>Anotações comerciais</span><p>' + esc(lead.commercialNotes || 'Nenhuma anotação comercial adicionada.') + '</p></div>' +
      '<div class="lead-workspace"><section class="lead-interaction-panel"><h3>Registrar contato</h3><p>Salve cada conversa e já programe o próximo passo.</p><form onsubmit="saveLeadActivity(event,\'' + esc(id) + '\')"><div class="form-grid">' +
        field('Tipo de contato', '<select name="activityType">' + options([{value:'whatsapp',label:'WhatsApp'},{value:'ligacao',label:'Ligação'},{value:'email',label:'E-mail'},{value:'reuniao',label:'Reunião'},{value:'nota',label:'Anotação'}], 'whatsapp') + '</select>') +
        field('Nova etapa', '<select name="newStage">' + options(leadStages, lead.leadStage || 'novo') + '</select>') +
        field('Próximo contato', '<input name="nextFollowUpAt" type="datetime-local" value="' + esc(dateTimeLocalValue(lead.nextFollowUpAt)) + '">') +
        field('Resumo do contato', '<textarea name="description" required placeholder="Ex.: Apresentei os planos e enviei a proposta pelo WhatsApp."></textarea>', true) +
      '</div><button class="btn btn-primary" type="submit">Registrar interação</button></form></section><section><div class="lead-history-head"><div><h3>Histórico</h3><p>Todos os contatos registrados pela equipe.</p></div></div><div id="lead-history-area">' + loading('lead-history-loading', 'Carregando histórico...') + '</div></section></div></div>';
    showModal(html, true);
    loadLeadActivities(id);
  }
  window.openLeadDetails = openLeadDetails;

  var activityLabels = { cadastro: 'Cadastro', ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', reuniao: 'Reunião', nota: 'Anotação', mudanca_etapa: 'Mudança de etapa' };

  async function loadLeadActivities(id) {
    var area = document.getElementById('lead-history-area');
    if (!area) return;
    try {
      var payload = await api('/api/leads/' + encodeURIComponent(id) + '/activities');
      var activities = payload.activities || [];
      area.innerHTML = activities.length ? '<div class="lead-timeline">' + activities.map(function (activity) {
        return '<article class="lead-timeline-item"><div class="lead-timeline-dot"></div><div><div class="lead-timeline-meta"><b>' + esc(activityLabels[activity.type] || 'Interação') + '</b><span>' + esc(dateTimeBR(activity.createdAt)) + '</span></div><p>' + esc(activity.description) + '</p><small>' + esc(activity.authorName || 'Equipe Óriva') + (activity.newStage ? ' · Etapa: ' + esc(leadStageLabel(activity.newStage)) : '') + '</small></div></article>';
      }).join('') + '</div>' : '<div class="management-inline-empty">Nenhuma interação registrada ainda.</div>';
    } catch (error) {
      area.innerHTML = '<div class="management-inline-empty error">' + esc(error.message) + '</div>';
    }
  }

  async function saveLeadActivity(event, id) {
    event.preventDefault();
    var form = event.currentTarget;
    var data = Object.fromEntries(new FormData(form).entries());
    if (data.nextFollowUpAt) data.nextFollowUpAt = new Date(data.nextFollowUpAt).toISOString();
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = 'Registrando...';
    try {
      await api('/api/leads/' + encodeURIComponent(id) + '/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      await loadCompanies();
      openLeadDetails(id);
      toast('Interação registrada no histórico.');
    } catch (error) {
      toast(error.message, true);
      button.disabled = false; button.textContent = 'Registrar interação';
    }
  }
  window.saveLeadActivity = saveLeadActivity;

  paginas.parceiros = function () {
    window.setTimeout(loadPartners, 0);
    return '<div class="page-head"><div><h1 class="page-title">Parceiros PJ</h1><p class="page-desc">Cadastros, especialidades, valores e demandas abertas</p></div>' +
      '<button class="btn btn-primary" onclick="openPartnerForm()">+ Novo parceiro</button></div>' + loading('partners-area', 'Carregando parceiros...');
  };

  async function loadPartners() {
    var area = document.getElementById('partners-area');
    if (!area) return;
    try {
      var payload = await api('/api/partners');
      state.partners = payload.partners || [];
      if (!state.partners.length) {
        area.innerHTML = empty('Nenhum parceiro cadastrado', 'Adicione fotógrafos, editores, videomakers e outros prestadores.', '<button class="btn btn-primary" onclick="openPartnerForm()">Adicionar parceiro</button>');
        return;
      }
      area.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>Parceiro</th><th>Contato</th><th>Especialidade</th><th>Valor médio</th><th>Demandas</th><th>Situação</th><th>Ações</th></tr></thead><tbody>' +
        state.partners.map(function (partner) {
          return '<tr data-search="' + esc([partner.name, partner.companyName, partner.email, partner.specialty, partner.status].join(' ')) + '"><td><div class="td-nome"><div class="avatar-sm" style="background:var(--preto)">' + esc(initials(partner.name)) + '</div><div>' + esc(partner.name) + '<div class="li-sub">' + esc(partner.companyName || 'Pessoa física/PJ') + '</div></div></div></td>' +
            '<td><div>' + esc(partner.email || 'Sem e-mail') + '</div><div class="li-sub">' + esc(partner.phone || '') + '</div><span class="tag ' + (partner.accessLinked ? 'tag-verde' : 'tag-amarelo') + '" style="margin-top:5px">' + (partner.accessLinked ? 'Acesso vinculado' : 'Sem acesso vinculado') + '</span></td><td>' + esc(partner.specialty) + '</td><td style="font-weight:700">' + money(partner.averageValueCents) + '</td>' +
            '<td>' + esc(partner.openDemands) + '</td><td><span class="tag ' + (partner.status === 'Ativo' ? 'tag-verde' : 'tag-cinza') + '">' + esc(partner.status) + '</span></td>' +
            '<td><div class="management-actions"><button class="btn btn-ghost" style="padding:7px 9px" onclick="openPartnerForm(\'' + esc(partner.id) + '\')">Editar</button><button class="btn btn-ghost" style="padding:7px 9px;color:var(--vermelho)" onclick="deletePartner(\'' + esc(partner.id) + '\')">Excluir</button></div></td></tr>';
        }).join('') + '</tbody></table></div>';
    } catch (error) {
      area.innerHTML = empty('Não foi possível carregar os parceiros', error.message, '<button class="btn btn-primary" onclick="loadPartners()">Tentar novamente</button>');
    }
  }
  window.loadPartners = loadPartners;

  function openPartnerForm(id) {
    var partner = state.partners.find(function (item) { return item.id === id; });
    var html = modalHead(partner ? 'Editar parceiro' : 'Adicionar parceiro PJ') +
      '<form onsubmit="savePartner(event,\'' + esc(id || '') + '\')"><div class="modal-body"><div class="form-grid">' +
      field('Nome', '<input name="name" required value="' + esc(partner ? partner.name : '') + '">') +
      field('Empresa / nome PJ', '<input name="companyName" value="' + esc(partner ? partner.companyName : '') + '">') +
      field('E-mail', '<input name="email" type="email" value="' + esc(partner ? partner.email : '') + '">', false, 'Use o mesmo e-mail da conta de acesso. O vínculo será feito automaticamente.') +
      field('Telefone', '<input name="phone" value="' + esc(partner ? partner.phone : '') + '">') +
      field('Especialidade', '<input name="specialty" required value="' + esc(partner ? partner.specialty : '') + '" placeholder="Ex.: Edição de vídeo">') +
      field('Valor médio (R$)', '<input name="averageValue" inputmode="decimal" value="' + esc(partner ? (partner.averageValueCents / 100).toFixed(2).replace('.', ',') : '') + '">') +
      field('Demandas abertas', '<input name="openDemands" type="number" min="0" value="' + esc(partner ? partner.openDemands : 0) + '">') +
      field('Situação', '<select name="status">' + options(['Ativo', 'Pausado', 'Inativo'], partner ? partner.status : 'Ativo') + '</select>') +
      field('Observações', '<textarea name="notes">' + esc(partner ? partner.notes : '') + '</textarea>', true) +
      '</div></div><div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button class="btn btn-primary" type="submit">Salvar parceiro</button></div></form>';
    showModal(html, false);
  }
  window.openPartnerForm = openPartnerForm;

  async function savePartner(event, id) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(event.currentTarget).entries());
    data.averageValueCents = cents(data.averageValue);
    delete data.averageValue;
    try {
      await api(id ? '/api/partners/' + encodeURIComponent(id) : '/api/partners', {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      closeManagementModal(); toast(id ? 'Parceiro atualizado.' : 'Parceiro adicionado.'); await loadPartners();
    } catch (error) { toast(error.message, true); }
  }
  window.savePartner = savePartner;

  async function deletePartner(id) {
    if (!window.confirm('Excluir este parceiro?')) return;
    try {
      await api('/api/partners/' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Parceiro excluído.'); await loadPartners();
    } catch (error) { toast(error.message, true); }
  }
  window.deletePartner = deletePartner;

  paginas.contratos = function () {
    window.setTimeout(loadContracts, 0);
    return '<div class="page-head"><div><h1 class="page-title">Contratos</h1><p class="page-desc">Vigências, valores e renovações de empresas e parceiros</p></div>' +
      '<button class="btn btn-primary" onclick="openContractForm()">+ Novo contrato</button></div>' + loading('contracts-area', 'Carregando contratos...');
  };

  async function loadContracts() {
    var area = document.getElementById('contracts-area');
    if (!area) return;
    try {
      var payload = await api('/api/contracts');
      state.contracts = payload.contracts || [];
      if (!state.contracts.length) {
        area.innerHTML = empty('Nenhum contrato cadastrado', 'Cadastre contratos de clientes e parceiros com suas vigências.', '<button class="btn btn-primary" onclick="openContractForm()">Adicionar contrato</button>');
        return;
      }
      var active = state.contracts.filter(function (item) { return item.status === 'Ativo'; }).length;
      var soon = state.contracts.filter(function (item) {
        if (!item.endDate || item.status !== 'Ativo') return false;
        var days = (new Date(item.endDate + 'T12:00:00') - new Date()) / 86400000;
        return days >= 0 && days <= 30;
      }).length;
      area.innerHTML = '<div class="grid g-3" style="margin-bottom:18px">' +
        kpi('contratos', String(active), 'Contratos ativos') + kpi('clock', String(soon), 'Vencem em 30 dias') + kpi('financeiro', money(state.contracts.reduce(function (sum, item) { return sum + Number(item.valueCents || 0); }, 0)), 'Valor total registrado') + '</div>' +
        '<div class="tbl-wrap"><table><thead><tr><th>Contrato</th><th>Parte</th><th>Vigência</th><th>Recorrência</th><th>Valor</th><th>Situação</th><th>Ações</th></tr></thead><tbody>' +
        state.contracts.map(function (contract) {
          return '<tr data-search="' + esc([contract.title, contract.partyName, contract.partyType, contract.status].join(' ')) + '"><td style="font-weight:700">' + esc(contract.title) + '</td>' +
            '<td><span class="tag ' + (contract.partyType === 'Empresa' ? 'tag-roxo' : 'tag-cinza') + '">' + esc(contract.partyType) + '</span><div class="li-sub" style="margin-top:4px">' + esc(contract.partyName) + '</div></td>' +
            '<td>' + esc(dateBR(contract.startDate)) + ' → ' + esc(contract.endDate ? dateBR(contract.endDate) : 'Indeterminado') + '</td><td><span class="tag tag-cinza">' + esc(contract.recurrence || 'Sem recorrência') + '</span></td><td style="font-weight:700">' + money(contract.valueCents) + '</td>' +
            '<td><span class="tag ' + (contract.status === 'Ativo' ? 'tag-verde' : contract.status === 'Renovar' ? 'tag-amarelo' : 'tag-cinza') + '">' + esc(contract.status) + '</span></td>' +
            '<td><div class="management-actions"><button class="btn btn-ghost" style="padding:7px 9px" onclick="openContractDocuments(\'' + esc(contract.id) + '\')">Documentos</button><button class="btn btn-ghost" style="padding:7px 9px" onclick="openContractForm(\'' + esc(contract.id) + '\')">Editar</button><button class="btn btn-ghost" style="padding:7px 9px;color:var(--vermelho)" onclick="deleteContract(\'' + esc(contract.id) + '\')">Excluir</button></div></td></tr>';
        }).join('') + '</tbody></table></div>';
    } catch (error) {
      area.innerHTML = empty('Não foi possível carregar os contratos', error.message, '<button class="btn btn-primary" onclick="loadContracts()">Tentar novamente</button>');
    }
  }
  window.loadContracts = loadContracts;

  function openContractForm(id) {
    var contract = state.contracts.find(function (item) { return item.id === id; });
    var today = new Date().toISOString().slice(0, 10);
    var html = modalHead(contract ? 'Editar contrato' : 'Adicionar contrato') +
      '<form onsubmit="saveContract(event,\'' + esc(id || '') + '\')"><div class="modal-body"><div class="form-grid">' +
      field('Título do contrato', '<input name="title" required value="' + esc(contract ? contract.title : '') + '" placeholder="Ex.: Gestão de redes sociais">') +
      field('Tipo', '<select name="partyType">' + options(['Empresa', 'Parceiro'], contract ? contract.partyType : 'Empresa') + '</select>') +
      field('Empresa ou parceiro', '<input name="partyName" required value="' + esc(contract ? contract.partyName : '') + '" placeholder="Nome da parte contratada">') +
      field('Data de início', '<input name="startDate" type="date" required value="' + esc(contract ? contract.startDate : today) + '">') +
      field('Data final', '<input name="endDate" type="date" value="' + esc(contract ? contract.endDate : '') + '">') +
      field('Valor (R$)', '<input name="value" inputmode="decimal" value="' + esc(contract ? (contract.valueCents / 100).toFixed(2).replace('.', ',') : '') + '">') +
      field('Situação', '<select name="status">' + options(['Ativo', 'Renovar', 'Encerrado', 'Cancelado'], contract ? contract.status : 'Ativo') + '</select>') +
      field('Recorrência', '<select name="recurrence">' + options(['Sem recorrência', 'Mensal', 'Trimestral', 'Semestral', 'Anual', 'Personalizada'], contract ? contract.recurrence : 'Sem recorrência') + '</select>') +
      field('Observações', '<textarea name="notes">' + esc(contract ? contract.notes : '') + '</textarea>', true) +
      '</div></div><div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button class="btn btn-primary" type="submit">Salvar contrato</button></div></form>';
    showModal(html, false);
  }
  window.openContractForm = openContractForm;

  async function saveContract(event, id) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(event.currentTarget).entries());
    data.valueCents = cents(data.value); delete data.value;
    try {
      await api(id ? '/api/contracts/' + encodeURIComponent(id) : '/api/contracts', {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      closeManagementModal(); toast(id ? 'Contrato atualizado.' : 'Contrato criado.'); await loadContracts();
    } catch (error) { toast(error.message, true); }
  }
  window.saveContract = saveContract;

  async function openContractDocuments(id) {
    var contract = state.contracts.find(function (item) { return item.id === id; });
    if (!contract) return;
    showModal(modalHead('Documentos do contrato') + '<div class="modal-body"><div class="document-panel-head"><div><h3>' + esc(contract.title) + '</h3><p class="page-desc">Arquivos originais relacionados a este contrato.</p></div></div><form id="contract-files-form" onsubmit="uploadContractDocuments(event,\'' + esc(id) + '\')"><label class="upload-zone upload-zone-active"><span class="upload-icon">' + ico.upload + '</span><b>Selecionar documentos</b><span>PDF, imagens, vídeos ou arquivos compactados</span><input name="files" type="file" multiple required></label><div class="modal-actions"><button class="btn btn-primary" type="submit">Enviar documentos</button></div></form><div id="contract-documents-list"><div class="loading-state"><div class="spinner"></div>Carregando documentos...</div></div></div>', true);
    await loadContractDocuments(id);
  }
  window.openContractDocuments = openContractDocuments;

  async function loadContractDocuments(id) {
    var area = document.getElementById('contract-documents-list'); if (!area) return;
    try {
      var payload = await api('/api/contract-files?contract_id=' + encodeURIComponent(id)); var files = payload.files || [];
      area.innerHTML = files.length ? '<div class="file-list">' + files.map(function (file) { return '<div class="file-row"><div class="file-main"><b>' + esc(file.fileName) + '</b><span>' + esc(formatFileSize(file.fileSize)) + '</span></div><div class="management-actions"><a class="btn-xs" href="' + esc(file.previewUrl) + '" target="_blank" rel="noopener">Abrir</a><a class="btn-xs" href="' + esc(file.downloadUrl) + '">Baixar</a><button class="btn-xs" style="color:var(--vermelho)" onclick="deleteContractDocument(\'' + esc(file.id) + '\',\'' + esc(id) + '\')">Excluir</button></div></div>'; }).join('') + '</div>' : '<div class="management-inline-empty">Nenhum documento anexado a este contrato.</div>';
    } catch (error) { area.innerHTML = '<div class="management-inline-empty error">' + esc(error.message) + '</div>'; }
  }

  async function uploadContractDocuments(event, id) {
    event.preventDefault(); var button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Enviando...';
    try { var form = new FormData(event.currentTarget); form.append('contract_id', id); await api('/api/contract-files', { method: 'POST', body: form }); event.currentTarget.reset(); toast('Documentos anexados ao contrato.'); await loadContractDocuments(id); } catch (error) { toast(error.message, true); } finally { button.disabled = false; button.textContent = 'Enviar documentos'; }
  }
  window.uploadContractDocuments = uploadContractDocuments;

  async function deleteContractDocument(fileId, contractId) {
    if (!window.confirm('Excluir este documento?')) return;
    try { await api('/api/contract-files?id=' + encodeURIComponent(fileId), { method: 'DELETE' }); toast('Documento excluído.'); await loadContractDocuments(contractId); } catch (error) { toast(error.message, true); }
  }
  window.deleteContractDocument = deleteContractDocument;

  async function deleteContract(id) {
    if (!window.confirm('Excluir este contrato?')) return;
    try {
      await api('/api/contracts/' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Contrato excluído.'); await loadContracts();
    } catch (error) { toast(error.message, true); }
  }
  window.deleteContract = deleteContract;

  paginas.financeiro = function () {
    window.setTimeout(function () { loadFinance(''); }, 0);
    return '<div class="page-head"><div><h1 class="page-title">Financeiro</h1><p class="page-desc">Mensalidades, receitas, contas a pagar e fluxo de caixa</p></div>' +
      '<div class="management-actions"><button class="btn btn-ghost" onclick="goToDelinquency()">Inadimplência</button><button class="btn btn-ghost" onclick="exportFinanceCsv()">Exportar CSV</button><button class="btn btn-ghost" onclick="openFinanceForm(\'receita\',\'Mensalidade\')">+ Mensalidade</button><button class="btn btn-primary" onclick="openFinanceForm()">+ Novo lançamento</button></div></div>' +
      '<div class="content-toolbar"><label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700">Filtrar por mês <input id="finance-month" type="month" value="" onchange="loadFinance(this.value)"></label><button class="btn btn-ghost" onclick="showFinancePanorama()">Todos os períodos</button><span id="finance-period-label" class="toolbar-note">Panorama financeiro completo</span><button class="btn btn-ghost" onclick="openFinanceForm(\'receita\')">+ Receita</button><button class="btn btn-ghost" onclick="openFinanceForm(\'despesa\')">+ Conta a pagar</button></div>' +
      loading('finance-area', 'Carregando lançamentos...');
  };

  async function loadFinance(month) {
    var area = document.getElementById('finance-area');
    if (!area) return;
    try {
      state.financePeriod = month || '';
      var periodLabel = document.getElementById('finance-period-label');
      if (periodLabel) periodLabel.textContent = month ? 'Exibindo somente ' + month.split('-').reverse().join('/') : 'Panorama financeiro completo';
      var values = await Promise.all([
        api(month ? '/api/finance?month=' + encodeURIComponent(month) : '/api/finance'),
        state.companies.length ? Promise.resolve({ companies: state.companies }) : api('/api/companies'),
        api('/api/finance?delinquent=1')
      ]);
      state.finance = values[0].entries || [];
      state.companies = values[1].companies || state.companies;
      state.delinquent = values[2].entries || [];
      renderFinance(area);
    } catch (error) {
      area.innerHTML = empty('Não foi possível abrir o financeiro', error.message, '<button class="btn btn-primary" onclick="loadFinance(document.getElementById(\'finance-month\').value)">Tentar novamente</button>');
    }
  }
  window.loadFinance = loadFinance;

  function showFinancePanorama() {
    var input = document.getElementById('finance-month');
    if (input) input.value = '';
    loadFinance('');
  }
  window.showFinancePanorama = showFinancePanorama;

  function renderFinance(area) {
    var income = state.finance.filter(function (item) { return item.kind === 'receita'; });
    var expense = state.finance.filter(function (item) { return item.kind === 'despesa'; });
    var totalIncome = income.reduce(function (sum, item) { return sum + Number(item.amountCents || 0); }, 0);
    var totalExpense = expense.reduce(function (sum, item) { return sum + Number(item.amountCents || 0); }, 0);
    var receivable = income.filter(function (item) { return item.status !== 'Pago' && item.status !== 'Cancelado'; }).reduce(function (sum, item) { return sum + Number(item.amountCents || 0); }, 0);
    var received = income.filter(function (item) { return item.status === 'Pago'; }).reduce(function (sum, item) { return sum + Number(item.amountCents || 0); }, 0);
    var payable = expense.filter(function (item) { return item.status !== 'Pago' && item.status !== 'Cancelado'; }).reduce(function (sum, item) { return sum + Number(item.amountCents || 0); }, 0);
    var paidExpenses = expense.filter(function (item) { return item.status === 'Pago'; }).reduce(function (sum, item) { return sum + Number(item.amountCents || 0); }, 0);
    var overdueTotal = state.delinquent.reduce(function (sum, item) { return sum + Number(item.amountCents || 0); }, 0);
    var periodSuffix = state.financePeriod ? ' do período' : ' totais';
    var summary = '<div class="grid g-3" style="margin-bottom:18px">' + kpi('trend', money(totalIncome), 'Receitas' + periodSuffix) + kpi('clock', money(totalExpense), 'Despesas' + periodSuffix) + kpi('financeiro', money(receivable), 'A receber') + kpi('check', money(received), 'Recebido') + kpi('clock', money(payable), 'A pagar') + kpi('check', money(paidExpenses), 'Já pago') + kpi('check', money(totalIncome - totalExpense), 'Saldo geral') + kpi('clientes', money(overdueTotal), 'Total inadimplente') + '</div>';
    if (!state.finance.length) {
      area.innerHTML = summary + empty(state.financePeriod ? 'Nenhum lançamento neste mês' : 'Nenhum lançamento financeiro', 'Adicione uma mensalidade, receita ou conta a pagar.', '<button class="btn btn-primary" onclick="openFinanceForm()">Criar lançamento</button>') + renderDelinquency();
      return;
    }
    area.innerHTML = summary + '<div class="tbl-wrap"><table><thead><tr><th>Descrição</th><th>Tipo</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Ações</th></tr></thead><tbody>' + state.finance.map(function (entry) {
      var overdue = entry.status === 'Pendente' && entry.dueDate < new Date().toISOString().slice(0, 10);
      var displayStatus = overdue ? 'Atrasado' : financeStatusLabel(entry.kind, entry.status);
      return '<tr data-search="' + esc([entry.description, entry.partyName, entry.category, displayStatus].join(' ')) + '"><td><div style="font-weight:700">' + esc(entry.description) + '</div><div class="li-sub">' + esc(entry.partyName || entry.category) + ' · ' + esc(entry.recurrence) + '</div></td>' +
        '<td><span class="tag ' + (entry.kind === 'receita' ? 'tag-verde' : 'tag-vermelho') + '">' + (entry.kind === 'receita' ? 'Receita' : 'Despesa') + '</span></td><td>' + esc(dateBR(entry.dueDate)) + '</td><td style="font-weight:800">' + money(entry.amountCents) + '</td>' +
        '<td><span class="tag ' + (entry.status === 'Pago' ? 'tag-verde' : displayStatus === 'Atrasado' ? 'tag-vermelho' : 'tag-amarelo') + '">' + esc(displayStatus) + '</span></td>' +
        '<td><div class="management-actions">' + (entry.status !== 'Pago' ? '<button class="btn-xs" onclick="markFinancePaid(\'' + esc(entry.id) + '\')">' + (entry.kind === 'receita' ? 'Marcar recebido' : 'Marcar pago') + '</button>' : '') + '<button class="btn-xs" onclick="openFinanceForm(null,null,\'' + esc(entry.id) + '\')">Editar</button><button class="btn-xs" style="color:var(--vermelho)" onclick="deleteFinance(\'' + esc(entry.id) + '\')">Excluir</button></div></td></tr>';
    }).join('') + '</tbody></table></div>' + renderDelinquency();
  }

  function renderDelinquency() {
    var total = state.delinquent.reduce(function (sum, entry) { return sum + Number(entry.amountCents || 0); }, 0);
    return '<section id="delinquency-section" class="card delinquency-card"><div class="card-h"><div><h3>Clientes inadimplentes</h3><p class="page-desc">Receitas vencidas e ainda não pagas, em todos os meses.</p></div><span class="tag ' + (state.delinquent.length ? 'tag-vermelho' : 'tag-verde') + '">' + state.delinquent.length + ' pendência' + (state.delinquent.length === 1 ? '' : 's') + '</span></div>' +
      (state.delinquent.length ? '<div class="delinquency-total">Total vencido: <b>' + money(total) + '</b></div><div class="file-list">' + state.delinquent.map(function (entry) { return '<div class="file-row delinquent-row"><div class="file-main"><b>' + esc(entry.partyName || entry.description) + '</b><span>' + esc(entry.description) + ' · venceu em ' + esc(dateBR(entry.dueDate)) + '</span></div><div class="management-actions"><strong>' + money(entry.amountCents) + '</strong><button class="btn-xs" onclick="markFinancePaid(\'' + esc(entry.id) + '\')">Marcar recebido</button></div></div>'; }).join('') + '</div>' : '<div class="management-inline-empty">Nenhum cliente inadimplente no momento.</div>') + '</section>';
  }

  function goToDelinquency() { var section = document.getElementById('delinquency-section'); if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  window.goToDelinquency = goToDelinquency;

  function financeStatusChoices(kind) {
    var income = kind === 'receita';
    return [
      { value: 'Pendente', label: income ? 'A receber' : 'A pagar' },
      { value: 'Atrasado', label: 'Atrasado' },
      { value: 'Pago', label: income ? 'Recebido' : 'Já pago' },
      { value: 'Cancelado', label: 'Cancelado' }
    ];
  }

  function financeStatusLabel(kind, status) {
    if (status === 'Pendente') return kind === 'receita' ? 'A receber' : 'A pagar';
    if (status === 'Pago') return kind === 'receita' ? 'Recebido' : 'Já pago';
    return status;
  }

  function syncFinanceStatusLabels(form) {
    if (!form) return;
    var kindField = form.querySelector('[name="kind"]');
    var statusField = form.querySelector('[name="status"]');
    if (!kindField || !statusField) return;
    var current = statusField.value || 'Pendente';
    statusField.innerHTML = options(financeStatusChoices(kindField.value), current);
  }
  window.syncFinanceStatusLabels = syncFinanceStatusLabels;

  function openFinanceForm(kind, category, id) {
    var entry = state.finance.find(function (item) { return item.id === id; });
    var selectedKind = entry ? entry.kind : (kind || 'receita');
    var selectedCategory = entry ? entry.category : (category || (selectedKind === 'receita' ? 'Mensalidade' : 'Operacional'));
    var today = new Date().toISOString().slice(0, 10);
    var companyOptions = state.companies.map(function (company) { return { value: company.id, label: company.name }; });
    var html = modalHead(entry ? 'Editar lançamento' : 'Novo lançamento financeiro') + '<form onsubmit="saveFinance(event,\'' + esc(id || '') + '\')"><div class="modal-body"><div class="form-grid">' +
      field('Tipo', '<select name="kind" onchange="syncFinanceStatusLabels(this.form)">' + options([{ value: 'receita', label: 'Receita / valor a receber' }, { value: 'despesa', label: 'Despesa / conta a pagar' }], selectedKind) + '</select>') +
      field('Categoria', '<select name="category">' + options(['Mensalidade', 'Parceiro', 'Operacional', 'Pró-labore', 'Imposto', 'Outro'], selectedCategory) + '</select>') +
      field('Descrição', '<input name="description" required value="' + esc(entry ? entry.description : '') + '" placeholder="Ex.: Mensalidade de agosto">') +
      field('Empresa / favorecido', '<input name="partyName" value="' + esc(entry ? entry.partyName : '') + '" placeholder="Nome relacionado ao lançamento">') +
      field('Empresa vinculada', '<select name="companyId">' + options(companyOptions, entry ? entry.companyId : '', 'Sem vínculo') + '</select>') +
      field('Valor (R$)', '<input name="amount" required inputmode="decimal" value="' + esc(entry ? (entry.amountCents / 100).toFixed(2).replace('.', ',') : '') + '">') +
      field('Vencimento', '<input name="dueDate" type="date" required value="' + esc(entry ? entry.dueDate : today) + '">') +
      field('Situação', '<select name="status">' + options(financeStatusChoices(selectedKind), entry ? entry.status : 'Pendente') + '</select>') +
      field('Recorrência', '<select name="recurrence">' + options(['Único', 'Mensal'], entry ? entry.recurrence : (selectedCategory === 'Mensalidade' ? 'Mensal' : 'Único')) + '</select>') +
      field('Observações', '<textarea name="notes">' + esc(entry ? entry.notes : '') + '</textarea>', true) + '</div></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button class="btn btn-primary" type="submit">Salvar lançamento</button></div></form>';
    showModal(html, false);
  }
  window.openFinanceForm = openFinanceForm;

  async function saveFinance(event, id) {
    event.preventDefault(); var data = Object.fromEntries(new FormData(event.currentTarget).entries());
    data.amountCents = cents(data.amount); delete data.amount;
    try {
      await api(id ? '/api/finance/' + encodeURIComponent(id) : '/api/finance', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      closeManagementModal(); toast(id ? 'Lançamento atualizado.' : 'Lançamento salvo.'); await loadFinance(document.getElementById('finance-month').value || '');
    } catch (error) { toast(error.message, true); }
  }
  window.saveFinance = saveFinance;

  async function markFinancePaid(id) {
    var entry = state.finance.find(function (item) { return item.id === id; }); if (!entry) return;
    var data = Object.assign({}, entry, { status: 'Pago', paidDate: new Date().toISOString().slice(0, 10) });
    try { await api('/api/finance/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); toast(entry.kind === 'receita' ? 'Recebimento registrado.' : 'Pagamento registrado.'); await loadFinance(document.getElementById('finance-month').value || ''); } catch (error) { toast(error.message, true); }
  }
  window.markFinancePaid = markFinancePaid;

  async function deleteFinance(id) {
    if (!window.confirm('Excluir este lançamento financeiro?')) return;
    try { await api('/api/finance/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Lançamento excluído.'); await loadFinance(document.getElementById('finance-month').value || ''); } catch (error) { toast(error.message, true); }
  }
  window.deleteFinance = deleteFinance;

  function exportFinanceCsv() {
    if (!state.finance.length) { toast('Não há lançamentos para exportar.', true); return; }
    var rows = [['Descrição', 'Tipo', 'Categoria', 'Parte', 'Valor', 'Vencimento', 'Situação']].concat(state.finance.map(function (entry) {
      return [entry.description, entry.kind, entry.category, entry.partyName, (entry.amountCents / 100).toFixed(2), entry.dueDate, entry.status];
    }));
    var csv = rows.map(function (row) { return row.map(function (cell) { return '"' + String(cell || '').replace(/"/g, '""') + '"'; }).join(';'); }).join('\n');
    var link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); link.download = 'financeiro-oriva.csv'; link.click(); URL.revokeObjectURL(link.href);
  }
  window.exportFinanceCsv = exportFinanceCsv;

  function responsibleFilterOptions() {
    var team = state.accesses.filter(function (access) {
      return access.role === 'agency_owner' || access.role === 'agency_member' || access.role === 'collaborator';
    });
    var profileIds = new Set(team.map(function (access) { return access.id; }));
    return team.map(function (access) {
      return { value: 'profile:' + access.id, label: access.name || access.email };
    }).concat(state.partners.filter(function (partner) {
      var partnerProfileId = partner.profileId || partner.profile_id || '';
      return !partnerProfileId || !profileIds.has(partnerProfileId);
    }).map(function (partner) {
      return { value: 'partner:' + partner.id, label: 'Parceiro · ' + partner.name };
    }));
  }

  function workItemMatchesPerson(item, value) {
    if (!value) return true;
    if (value.indexOf('profile:') === 0) {
      var profileId = value.slice(8);
      var linkedPartnerIds = state.partners.filter(function (partner) {
        return (partner.profileId || partner.profile_id || '') === profileId;
      }).map(function (partner) { return partner.id; });
      return item.assignedTo === profileId || item.partnerProfileId === profileId || linkedPartnerIds.includes(item.partnerId);
    }
    if (value.indexOf('partner:') === 0) return item.partnerId === value.slice(8);
    return item.assignedTo === value || item.partnerId === value;
  }

  function openWorkItem(id) {
    var item = state.tasks.find(function (current) { return current.id === id; });
    if (!item) { toast('Atividade não encontrada.', true); return; }
    if (item.entityType === 'post') {
      if (typeof window.abrirConteudoAgenda === 'function') {
        window.abrirConteudoAgenda(item.tenantId, item.id);
      } else {
        window.abrirCalendarioEmpresa(item.tenantId);
      }
      return;
    }
    if (canManageAgencyTasks()) openTaskForm(id);
    else openTaskDetails(id);
  }
  window.openWorkItem = openWorkItem;

  function openWorkItemByKeyboard(event, id) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openWorkItem(id);
  }
  window.openWorkItemByKeyboard = openWorkItemByKeyboard;

  paginas.tarefas = function () {
    window.setTimeout(loadTasks, 0);
    var readOnly = !canManageAgencyTasks();
    return '<div class="page-head"><div><h1 class="page-title">' + (readOnly ? 'Minhas demandas' : 'Painel geral dos sócios') + '</h1><p class="page-desc">' + (readOnly ? 'Tarefas e conteúdos atribuídos a você como responsável ou Parceiro PJ' : 'Tarefas e conteúdos compartilhados, responsáveis, prazos e entregas') + '</p></div>' + (readOnly ? '' : '<button class="btn btn-primary" onclick="openTaskForm()">+ Nova atividade</button>') + '</div>' +
      '<div class="content-toolbar">' + (readOnly ? '<select id="task-status-filter" onchange="renderTasks()"><option value="">Todas as situações</option><option>Pendente</option><option>Em andamento</option><option>Atrasado</option><option>Concluído</option></select>' : '<select id="task-company-filter" onchange="renderTasks()"><option value="">Todas as empresas</option></select><select id="task-person-filter" onchange="renderTasks()"><option value="">Todos os responsáveis</option></select>') + '<button class="btn btn-ghost" onclick="loadTasks()">Atualizar</button></div>' +
      loading('tasks-area', readOnly ? 'Carregando suas demandas...' : 'Carregando atividades dos sócios...');
  };

  async function loadTasks() {
    var area = document.getElementById('tasks-area'); if (!area) return;
    try {
      if (!canManageAgencyTasks()) {
        var ownPayload = await api('/api/work-items');
        state.tasks = ownPayload.tasks || [];
        state.taskOptionsLoaded = false;
        renderTasks();
        return;
      }
      var values = await Promise.all([
        api('/api/work-items'),
        state.companies.length ? Promise.resolve({ companies: state.companies }) : api('/api/companies'),
        api('/api/access'),
        state.partners.length ? Promise.resolve({ partners: state.partners }) : api('/api/partners')
      ]);
      state.tasks = values[0].tasks || [];
      state.companies = values[1].companies || state.companies;
      state.accesses = values[2].accesses || [];
      state.partners = values[3].partners || state.partners;
      state.taskOptionsLoaded = true;
      var companyFilter = document.getElementById('task-company-filter');
      var personFilter = document.getElementById('task-person-filter');
      if (companyFilter) companyFilter.innerHTML = options(state.companies.map(function (company) { return { value: company.id, label: company.name }; }), companyFilter.value, 'Todas as empresas');
      if (personFilter) personFilter.innerHTML = options(responsibleFilterOptions(), personFilter.value, 'Todos os responsáveis');
      renderTasks();
    } catch (error) {
      area.innerHTML = empty(canManageAgencyTasks() ? 'Não foi possível abrir o painel dos sócios' : 'Não foi possível abrir suas demandas', error.message, '<button class="btn btn-primary" onclick="loadTasks()">Tentar novamente</button>');
    }
  }
  window.loadTasks = loadTasks;

  function renderTasks() {
    var area = document.getElementById('tasks-area'); if (!area) return;
    var companyId = document.getElementById('task-company-filter') ? document.getElementById('task-company-filter').value : '';
    var person = document.getElementById('task-person-filter') ? document.getElementById('task-person-filter').value : '';
    var status = document.getElementById('task-status-filter') ? document.getElementById('task-status-filter').value : '';
    var readOnly = !canManageAgencyTasks();
    var visible = state.tasks.filter(function (task) {
      return (!companyId || task.tenantId === companyId) && workItemMatchesPerson(task, person) && (!status || task.displayStatus === status);
    });
    var columns = ['Pendente', 'Em andamento', 'Atrasado', 'Concluído'];
    var colors = { 'Pendente': '#94a3b8', 'Em andamento': '#2563eb', 'Atrasado': '#dc2626', 'Concluído': '#16a34a' };
    if (!visible.length) {
      area.innerHTML = empty(readOnly ? 'Nenhuma demanda ou conteúdo atribuído a você' : 'Nenhuma atividade encontrada', readOnly ? 'Quando um sócio atribuir uma tarefa ou conteúdo ao seu perfil, o item aparecerá aqui.' : 'Crie uma atividade ou altere os filtros para acompanhar o trabalho dos sócios.', readOnly ? '' : '<button class="btn btn-primary" onclick="openTaskForm()">Criar atividade</button>');
      return;
    }
    area.innerHTML = '<div class="task-board">' + columns.map(function (column) {
      var tasks = visible.filter(function (task) { return task.displayStatus === column; });
      return '<section class="task-column"><div class="task-column-head"><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + colors[column] + ';margin-right:6px"></i>' + column + '</span><span class="kb-count">' + tasks.length + '</span></div>' +
        (tasks.length ? tasks.map(function (task) {
          var contentItem = task.entityType === 'post';
          var clickable = readOnly || contentItem;
          var secondaryTag = contentItem
            ? '<span class="tag tag-azul">Calendário de Posts</span>'
            : '<span class="tag ' + (task.priority === 'Alta' || task.priority === 'Urgente' ? 'tag-vermelho' : task.priority === 'Média' ? 'tag-amarelo' : 'tag-cinza') + '">' + esc(task.priority) + '</span>';
          var actions = contentItem
            ? '<span class="btn-xs">Abrir conteúdo</span>'
            : readOnly
              ? '<span class="btn-xs">Ver detalhes</span>'
              : (column !== 'Concluído' ? '<button class="btn-xs" onclick="completeTask(\'' + esc(task.id) + '\')">✓ Concluir</button>' : '<button class="btn-xs" onclick="reopenTask(\'' + esc(task.id) + '\')">Reabrir</button>') + '<button class="btn-xs" onclick="openTaskForm(\'' + esc(task.id) + '\')">Editar</button><button class="btn-xs" style="color:var(--vermelho)" onclick="deleteTask(\'' + esc(task.id) + '\')">Excluir</button>';
          return '<article class="task-item' + (clickable ? ' task-item-clickable' : '') + '"' + (clickable ? ' role="button" tabindex="0" onclick="openWorkItem(\'' + esc(task.id) + '\')" onkeydown="openWorkItemByKeyboard(event,\'' + esc(task.id) + '\')"' : '') + ' data-search="' + esc([task.title, task.companyName, task.taskType, task.sourceLabel, task.assignedToName, task.partnerName, task.displayStatus].join(' ')) + '" style="border-left-color:' + colors[column] + '"><div class="kb-tags"><span class="tag tag-roxo">' + esc(task.taskType) + '</span>' + secondaryTag + '</div><h4>' + esc(task.title) + '</h4><div class="task-meta">' + esc(task.companyName || 'Atividade interna') + '<br>' + (contentItem ? 'Publicação' : 'Entrega') + ': ' + esc(dateBR(task.dueDate)) + (task.scheduledTime ? ' às ' + esc(task.scheduledTime) : '') + '<br>Responsável interno: ' + esc(task.assignedToName || 'Não definido') + (task.partnerName ? '<br>Parceiro responsável: ' + esc(task.partnerName) : '') + '</div><div class="task-actions">' + actions + '</div></article>';
        }).join('') : '<div class="page-desc" style="text-align:center;padding:20px 4px">Nenhuma atividade</div>') + '</section>';
    }).join('') + '</div>';
  }
  window.renderTasks = renderTasks;

  function openTaskDetails(id) {
    var task = state.tasks.find(function (item) { return item.id === id; });
    if (!task) { toast('Demanda não encontrada.', true); return; }
    showModal(modalHead('Atualizar demanda atribuída') + '<form onsubmit="saveAssignedTask(event,\'' + esc(task.id) + '\')"><div class="modal-body"><div class="detail-summary"><span class="tag tag-roxo">' + esc(task.taskType) + '</span><h3>' + esc(task.title) + '</h3><p>' + esc(task.companyName || 'Atividade interna') + ' · entrega em ' + esc(dateBR(task.dueDate)) + '</p></div><section class="form-section"><div class="form-section-title">Descrição e andamento</div><div class="form-section-desc">Atualize somente as informações de execução desta demanda.</div><div class="form-grid">' + field('Situação', '<select name="status">' + options(['Pendente', 'Em andamento', 'Atrasado', 'Concluído'], task.status) + '</select>') + field('Prioridade', '<input value="' + esc(task.priority) + '" disabled>') + field('Descrição', '<textarea name="description" placeholder="Detalhes, links e orientações...">' + esc(task.description || '') + '</textarea>', true) + '</div></section><section class="form-section"><div class="form-section-title">Arquivos da demanda</div><div class="form-section-desc">Você pode abrir os materiais existentes e anexar novos arquivos para os sócios.</div><div id="assigned-task-files"><div class="loading-state"><div class="spinner"></div>Carregando arquivos...</div></div></section><label class="upload-zone upload-zone-active"><span class="upload-icon">' + ico.upload + '</span><b>Anexar novos materiais</b><span>Os arquivos originais são preservados sem compressão</span><input name="files" type="file" multiple></label></div><div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button id="save-assigned-task-button" class="btn btn-primary" type="submit">Salvar atualização</button></div></form>', true);
    window.setTimeout(function () { loadAssignedTaskFiles(task.id); }, 0);
  }
  window.openTaskDetails = openTaskDetails;

  function openTaskDetailsByKeyboard(event, id) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openTaskDetails(id);
  }
  window.openTaskDetailsByKeyboard = openTaskDetailsByKeyboard;

  async function loadAssignedTaskFiles(taskId) {
    var area = document.getElementById('assigned-task-files'); if (!area) return;
    try {
      var payload = await api('/api/task-files?task_id=' + encodeURIComponent(taskId));
      var files = payload.files || []; var actor = state.session && state.session.actor ? state.session.actor : {};
      area.innerHTML = '<div class="file-list">' + (files.length ? files.map(function (file) {
        var canDelete = file.uploadedBy && file.uploadedBy === actor.id;
        return '<div class="file-row"><div class="file-main"><b>' + esc(file.fileName) + '</b><span>' + esc(formatFileSize(file.fileSize)) + '</span></div><div class="management-actions"><a class="btn-xs" href="' + esc(file.previewUrl) + '" target="_blank" rel="noopener">Abrir</a><a class="btn-xs" href="' + esc(file.downloadUrl) + '">Baixar</a>' + (canDelete ? '<button type="button" class="btn-xs" style="color:var(--vermelho)" onclick="deleteAssignedTaskFile(\'' + esc(file.id) + '\',\'' + esc(taskId) + '\')">Excluir meu envio</button>' : '') + '</div></div>';
      }).join('') : '<div class="management-inline-empty">Nenhum arquivo anexado ainda.</div>') + '</div>';
    } catch (error) { area.innerHTML = '<div class="management-inline-empty">' + esc(error.message) + '</div>'; }
  }
  window.loadAssignedTaskFiles = loadAssignedTaskFiles;

  async function saveAssignedTask(event, id) {
    event.preventDefault(); var form = event.currentTarget; var button = document.getElementById('save-assigned-task-button');
    if (button) { button.disabled = true; button.textContent = 'Salvando...'; }
    try {
      var data = new FormData(form);
      await api('/api/tasks/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: data.get('description'), status: data.get('status') }) });
      var files = data.getAll('files').filter(function (file) { return file && file.size > 0; });
      if (files.length) {
        var upload = new FormData(); upload.append('task_id', id); files.forEach(function (file) { upload.append('files', file); });
        await api('/api/task-files', { method: 'POST', body: upload });
      }
      closeManagementModal(); toast(files.length ? 'Demanda atualizada e arquivos anexados.' : 'Demanda atualizada.'); await refreshTasksView();
    } catch (error) { toast(error.message, true); if (button) { button.disabled = false; button.textContent = 'Salvar atualização'; } }
  }
  window.saveAssignedTask = saveAssignedTask;

  async function deleteAssignedTaskFile(fileId, taskId) {
    if (!window.confirm('Excluir este arquivo enviado por você?')) return;
    try { await api('/api/task-files?id=' + encodeURIComponent(fileId), { method: 'DELETE' }); toast('Arquivo excluído.'); await loadAssignedTaskFiles(taskId); } catch (error) { toast(error.message, true); }
  }
  window.deleteAssignedTaskFile = deleteAssignedTaskFile;

  function openTaskForm(id) {
    if (!canManageAgencyTasks()) {
      if (id) openTaskDetails(id); else toast('Apenas os sócios podem criar novas demandas.', true);
      return;
    }
    if (!state.taskOptionsLoaded) {
      prepareTaskForm(id);
      return;
    }
    var task = state.tasks.find(function (item) { return item.id === id; });
    var today = new Date().toISOString().slice(0, 10);
    var companyOptions = state.companies.map(function (company) { return { value: company.id, label: company.name }; });
    var teamOptions = state.accesses.filter(function (access) { return access.role === 'agency_owner' || access.role === 'agency_member' || access.role === 'collaborator'; }).map(function (access) { return { value: access.id, label: access.name || access.email }; });
    var partnerOptions = state.partners.map(function (partner) { return { value: partner.id, label: partner.name + (partner.specialty ? ' · ' + partner.specialty : '') }; });
    var html = modalHead(task ? 'Editar atividade' : 'Nova atividade dos sócios') + '<form onsubmit="saveTask(event,\'' + esc(id || '') + '\')"><div class="modal-body"><div class="form-grid">' +
      field('Título', '<input name="title" required value="' + esc(task ? task.title : '') + '" placeholder="Ex.: Criar calendário de agosto">') +
      field('Tipo de atividade', '<select name="taskType">' + options(['Post', 'Calendário', 'Site', 'Reunião', 'Entrega', 'Financeiro', 'Outro'], task ? task.taskType : 'Post') + '</select>') +
      field('Empresa', '<select name="tenantId">' + options(companyOptions, task ? task.tenantId : '', 'Atividade interna') + '</select>') +
      field('Responsável', '<select name="assignedTo">' + options(teamOptions, task ? task.assignedTo : '', 'Selecionar sócio') + '</select>') +
      field('Parceiro responsável', '<select name="partnerId">' + options(partnerOptions, task ? task.partnerId : '', 'Sem parceiro atribuído') + '</select>', false, 'Quando selecionado, a demanda aparece no acesso do parceiro e no calendário da empresa.') +
      field('Data de entrega', '<input name="dueDate" type="date" required value="' + esc(task ? task.dueDate : today) + '">') +
      field('Prioridade', '<select name="priority">' + options(['Baixa', 'Média', 'Alta', 'Urgente'], task ? task.priority : 'Média') + '</select>') +
      field('Situação', '<select name="status">' + options(['Pendente', 'Em andamento', 'Atrasado', 'Concluído'], task ? task.status : 'Pendente') + '</select>') +
      field('Descrição', '<textarea name="description" placeholder="Detalhes, links e orientações...">' + esc(task ? task.description : '') + '</textarea>', true) + '</div></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button class="btn btn-primary" type="submit">Salvar atividade</button></div></form>';
    showModal(html, false);
  }
  window.openTaskForm = openTaskForm;

  async function prepareTaskForm(id) {
    if (!canManageAgencyTasks()) { if (id) openTaskDetails(id); return; }
    try {
      var values = await Promise.all([api('/api/companies'), api('/api/access'), api('/api/partners')]);
      state.companies = values[0].companies || [];
      state.accesses = values[1].accesses || [];
      state.partners = values[2].partners || [];
      state.taskOptionsLoaded = true;
      openTaskForm(id);
    } catch (error) {
      toast(error.message, true);
    }
  }
  window.prepareTaskForm = prepareTaskForm;

  async function saveTask(event, id) {
    event.preventDefault(); var data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!canManageAgencyTasks()) { toast('Apenas os sócios podem criar ou editar demandas.', true); return; }
    var button = event.currentTarget.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = 'Salvando...'; }
    try { await api(id ? '/api/tasks/' + encodeURIComponent(id) : '/api/tasks', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); closeManagementModal(); toast(id ? 'Atividade atualizada.' : 'Atividade criada para os sócios.'); await refreshTasksView(); } catch (error) { toast(error.message, true); if (button) { button.disabled = false; button.textContent = 'Salvar atividade'; } }
  }
  window.saveTask = saveTask;

  async function patchTaskStatus(id, status) {
    if (!canManageAgencyTasks()) { toast('Seu perfil possui acesso somente para visualização.', true); return; }
    var task = state.tasks.find(function (item) { return item.id === id; }); if (!task) return;
    var data = Object.assign({}, task, { status: status });
    try { await api('/api/tasks/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); toast(status === 'Concluído' ? 'Atividade concluída.' : 'Atividade reaberta.'); await refreshTasksView(); } catch (error) { toast(error.message, true); }
  }
  function completeTask(id) { return patchTaskStatus(id, 'Concluído'); }
  function reopenTask(id) { return patchTaskStatus(id, 'Pendente'); }
  window.completeTask = completeTask; window.reopenTask = reopenTask;

  async function deleteTask(id) {
    if (!canManageAgencyTasks()) { toast('Seu perfil possui acesso somente para visualização.', true); return; }
    if (!window.confirm('Excluir esta atividade?')) return;
    try { await api('/api/tasks/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Atividade excluída.'); await refreshTasksView(); } catch (error) { toast(error.message, true); }
  }
  window.deleteTask = deleteTask;

  function refreshTasksView() {
    if (document.getElementById('agenda-area')) return loadAgenda();
    if (document.getElementById('tasks-area')) return loadTasks();
    if (document.getElementById('dashboard-real-area')) return loadDashboard();
    return Promise.resolve();
  }
  window.refreshTasksView = refreshTasksView;

  paginas.acessos = function () {
    window.setTimeout(loadAccesses, 0);
    var canCreate = state.session && state.session.canManageAccess;
    return '<div class="page-head"><div><h1 class="page-title">Acessos e equipe</h1><p class="page-desc">Crie os acessos individuais dos sócios e clientes</p></div><button id="new-access-button" class="btn btn-primary" style="display:' + (canCreate ? '' : 'none') + '" onclick="openAccessForm()">+ Criar acesso</button></div>' +
      '<div class="access-banner"><div><h3>Uma área geral para todos os sócios</h3><p>Os sócios autorizados veem as mesmas empresas, atividades, contratos e calendários. Clientes veem somente a empresa à qual estão vinculados.</p></div><span class="tag" style="background:rgba(255,255,255,.12);color:#fff">Separação no backend</span></div>' + loading('access-area', 'Carregando acessos...');
  };

  async function loadAccesses() {
    var area = document.getElementById('access-area'); if (!area) return;
    try {
      var values = await Promise.all([api('/api/access'), state.companies.length ? Promise.resolve({ companies: state.companies }) : api('/api/companies')]);
      state.accesses = values[0].accesses || []; state.partners = values[0].partners || state.partners; state.canManageAccess = !!values[0].canManage; state.companies = values[1].companies || state.companies;
      var createButton = document.getElementById('new-access-button'); if (createButton) createButton.style.display = state.canManageAccess ? '' : 'none';
      area.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>Usuário</th><th>Tipo de acesso</th><th>Empresa</th><th>Situação</th><th>Ações</th></tr></thead><tbody>' + state.accesses.map(function (access) {
        var roleLabel = access.role === 'agency_owner' ? 'Administrador principal' : access.role === 'agency_member' ? 'Sócio' : access.role === 'collaborator' ? 'Colaborador interno' : access.role === 'partner' ? 'Parceiro PJ' : 'Cliente';
        return '<tr data-search="' + esc([access.name, access.email, roleLabel, access.companyName, access.partnerName, access.status].join(' ')) + '"><td><div class="td-nome"><div class="avatar-sm" style="background:' + (access.role === 'client' ? 'var(--roxo)' : 'var(--preto)') + '">' + esc(initials(access.name || access.email)) + '</div><div>' + esc(access.name || 'Sem nome') + '<div class="li-sub">' + esc(access.email) + '</div></div></div></td><td><span class="tag ' + (access.role === 'client' ? 'tag-roxo' : 'tag-azul') + '">' + roleLabel + '</span></td><td>' + esc(access.role === 'partner' ? (access.partnerName || 'Parceiro não vinculado') : (access.companyName || 'Todas as empresas')) + '</td><td><span class="tag ' + (access.status === 'Ativo' ? 'tag-verde' : 'tag-cinza') + '">' + esc(access.status) + '</span></td><td>' + (state.canManageAccess && access.role !== 'agency_owner' ? '<div class="management-actions"><button class="btn-xs" onclick="openAccessForm(\'' + esc(access.id) + '\')">Editar</button><button class="btn-xs" style="color:var(--vermelho)" onclick="deleteAccess(\'' + esc(access.id) + '\')">Desativar</button></div>' : '<span class="li-sub">Protegido</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    } catch (error) { area.innerHTML = empty('Não foi possível carregar os acessos', error.message, '<button class="btn btn-primary" onclick="loadAccesses()">Tentar novamente</button>'); }
  }
  window.loadAccesses = loadAccesses;

  function accessCompanyVisibility(select) {
    var company = document.getElementById('access-company-field');
    if (company) company.style.display = select.value === 'client' ? '' : 'none';
    var partner = document.getElementById('access-partner-field');
    if (partner) partner.style.display = select.value === 'partner' ? '' : 'none';
  }
  window.accessCompanyVisibility = accessCompanyVisibility;

  function openAccessForm(id) {
    var canManage = state.canManageAccess || Boolean(state.session && state.session.canManageAccess);
    if (!canManage) { toast('Apenas o administrador principal pode criar ou editar acessos.', true); return; }
    var access = state.accesses.find(function (item) { return item.id === id; });
    var companyOptions = state.companies.map(function (company) { return { value: company.id, label: company.name }; });
    var partnerOptions = state.partners.map(function (partner) { return { value: partner.id, label: partner.name + (partner.specialty ? ' · ' + partner.specialty : '') }; });
    var role = access ? access.role : 'agency_member';
    var html = modalHead(access ? 'Editar acesso' : 'Criar novo acesso') + '<form onsubmit="saveAccess(event,\'' + esc(id || '') + '\')"><div class="modal-body"><div class="form-grid">' +
      field('Nome', '<input name="name" required value="' + esc(access ? access.name : '') + '" placeholder="Nome do sócio ou cliente">') +
      field('E-mail de acesso', '<input name="email" type="email" required value="' + esc(access ? access.email : '') + '">') +
      field('Telefone', '<input name="phone" value="' + esc(access ? access.phone : '') + '">') +
      field('Perfil', '<select name="role" onchange="accessCompanyVisibility(this)">' + options([{ value: 'agency_member', label: 'Sócio — acesso geral' }, { value: 'collaborator', label: 'Colaborador — conteúdo e tarefas' }, { value: 'client', label: 'Cliente — somente a própria empresa' }, { value: 'partner', label: 'Parceiro PJ — demandas atribuídas' }], role) + '</select>') +
      '<label class="field" id="access-company-field" style="display:' + (role === 'client' ? '' : 'none') + '"><span>Empresa do cliente</span><select name="tenantId">' + options(companyOptions, access ? access.tenantId : '', 'Selecionar empresa') + '</select></label>' +
      '<label class="field" id="access-partner-field" style="display:' + (role === 'partner' ? '' : 'none') + '"><span>Cadastro de Parceiro PJ</span><select name="partnerId">' + options(partnerOptions, access ? access.partnerId : '', 'Selecionar parceiro') + '</select><small>O parceiro verá somente as demandas e calendários atribuídos a ele.</small></label>' +
      field('Situação', '<select name="status">' + options(['Ativo', 'Inativo'], access ? access.status : 'Ativo') + '</select>') +
      field(access ? 'Nova senha (opcional)' : 'Senha temporária', '<div style="display:flex;gap:8px"><input id="access-password" name="password" type="password" minlength="8" ' + (access ? '' : 'required') + ' autocomplete="new-password" style="flex:1"><button type="button" class="btn btn-ghost" onclick="generateTemporaryPassword(\'access-password\')">Gerar</button></div>', true) + '</div>' +
      '<div class="secure-login-note"><b>Senha protegida pelo Supabase Auth</b><span>A senha é criada ou alterada no serviço de autenticação e nunca é gravada nas tabelas da plataforma.</span></div></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button class="btn btn-primary" type="submit">Salvar acesso</button></div></form>';
    showModal(html, false);
  }
  window.openAccessForm = openAccessForm;

  async function saveAccess(event, id) {
    event.preventDefault(); var data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await api(id ? '/api/access/' + encodeURIComponent(id) : '/api/access', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); closeManagementModal(); toast(id ? 'Acesso atualizado.' : 'Acesso criado.'); await loadAccesses(); } catch (error) { toast(error.message, true); }
  }
  window.saveAccess = saveAccess;

  async function deleteAccess(id) {
    if (!window.confirm('Desativar este acesso? A pessoa não conseguirá usar a plataforma até ser reativada.')) return;
    try { await api('/api/access/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Acesso desativado.'); await loadAccesses(); } catch (error) { toast(error.message, true); }
  }
  window.deleteAccess = deleteAccess;

  if (navConfig && navConfig.cliente) navConfig.cliente.forEach(function (item) { delete item.cnt; });

  paginas.dashboard = function () {
    window.setTimeout(loadDashboard, 0);
    var actor = state.session && state.session.actor; var name = actor ? (actor.name || actor.email) : 'equipe';
    var readOnly = !canManageAgencyTasks();
    return '<div class="page-head"><div><h1 class="page-title">Olá, ' + esc(name.split(' ')[0]) + ' 👋</h1><p class="page-desc">' + (readOnly ? 'Acompanhe as tarefas e conteúdos atribuídos ao seu perfil ou cadastro de Parceiro PJ' : 'Visão real da operação da Óriva hoje') + '</p></div>' + (readOnly ? '<button class="btn btn-ghost" onclick="irPara(\'tarefas\')">Ver minhas demandas</button>' : '<button class="btn btn-primary" onclick="openTaskForm()">+ Nova atividade</button>') + '</div>' + loading('dashboard-real-area', 'Atualizando indicadores...');
  };

  async function loadDashboard() {
    var area = document.getElementById('dashboard-real-area'); if (!area) return;
    try {
      if (!canManageAgencyTasks()) {
        var ownPayload = await api('/api/work-items');
        state.tasks = ownPayload.tasks || [];
        var ownPending = state.tasks.filter(function (task) { return task.status !== 'Concluído'; });
        var ownOverdue = state.tasks.filter(function (task) { return task.displayStatus === 'Atrasado'; });
        var ownCompleted = state.tasks.filter(function (task) { return task.status === 'Concluído'; });
        var ownUpcoming = ownPending.slice().sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); }).slice(0, 8);
        area.innerHTML = '<div class="grid g-3" style="margin-bottom:22px">' + kpi('tarefas', String(ownPending.length), 'Minhas demandas abertas', '', '', "irPara('tarefas')") + kpi('clock', String(ownOverdue.length), 'Minhas demandas atrasadas', '', '', "irPara('tarefas')") + kpi('check', String(ownCompleted.length), 'Minhas demandas concluídas', '', '', "irPara('tarefas')") + '</div>' + (ownUpcoming.length ? '<div class="card"><div class="card-h"><h3>Próximas entregas atribuídas a você</h3><button class="btn btn-ghost" onclick="irPara(\'agenda\')">Abrir minha agenda</button></div>' + ownUpcoming.map(function (task) { return '<button class="dashboard-line" onclick="openWorkItem(\'' + esc(task.id) + '\')"><span><b>' + esc(task.title) + '</b><small>' + esc(task.companyName || 'Atividade interna') + ' · ' + esc(task.sourceLabel || 'Tarefa') + ' · ' + esc(task.displayStatus) + '</small></span><strong class="' + (task.displayStatus === 'Atrasado' ? 'danger-text' : '') + '">' + esc(dateBR(task.dueDate)) + '</strong></button>'; }).join('') + '</div>' : empty('Nenhuma demanda ou conteúdo atribuído a você', 'Quando um sócio atribuir uma tarefa ou conteúdo ao seu perfil, o item aparecerá aqui.', ''));
        return;
      }
      var month = new Date().toISOString().slice(0, 7);
      var canViewFinance = typeof window.canAccessOrivaPage !== 'function' || window.canAccessOrivaPage('financeiro');
      var values = await Promise.all([api('/api/work-items'), api('/api/companies'), canViewFinance ? api('/api/finance?month=' + month) : Promise.resolve({ entries: [] }), api('/api/dashboard')]);
      state.tasks = values[0].tasks || []; state.companies = values[1].companies || []; state.finance = values[2].entries || [];
      var awaitingApproval = values[3].awaitingApproval || [];
      var partnerTasks = state.tasks.filter(function (task) { return task.partnerId && task.displayStatus !== 'Concluído'; });
      var pending = state.tasks.filter(function (task) { return task.status !== 'Concluído'; });
      var overdue = state.tasks.filter(function (task) { return task.displayStatus === 'Atrasado'; });
      var activeCompanies = state.companies.filter(function (company) { return company.status === 'Ativo'; });
      var receivable = state.finance.filter(function (entry) { return entry.kind === 'receita' && entry.status !== 'Pago' && entry.status !== 'Cancelado'; }).reduce(function (sum, entry) { return sum + Number(entry.amountCents || 0); }, 0);
      var upcoming = pending.slice().sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); }).slice(0, 6);
      area.innerHTML = '<div class="grid g-3 dashboard-highlight-grid" style="margin-bottom:18px">' + kpi('clock', String(overdue.length), 'Demandas em atraso', '', '', "irPara('tarefas')") + kpi('agenda', String(awaitingApproval.length), 'Projetos em aprovação', '', '', "irPara('calendario-posts')") + kpi('parceiros', String(partnerTasks.length), 'Demandas com parceiros', '', '', "irPara('tarefas')") + '</div><div class="grid ' + (canViewFinance ? 'g-3' : 'g-2') + '" style="margin-bottom:24px">' + kpi('tarefas', String(pending.length), 'Atividades pendentes', '', '', "irPara('tarefas')") + kpi('clientes', String(activeCompanies.length), 'Empresas ativas', '', '', "irPara('clientes')") + (canViewFinance ? kpi('financeiro', money(receivable), 'A receber no mês', '', '', "irPara('financeiro')") : '') + '</div>' +
        '<div class="dashboard-operations-grid">' + dashboardListCard('Demandas em atraso', overdue, function (task) { return '<button class="dashboard-line" onclick="openWorkItem(\'' + esc(task.id) + '\')"><span><b>' + esc(task.title) + '</b><small>' + esc(task.companyName || 'Atividade interna') + ' · ' + esc(task.sourceLabel || 'Tarefa') + '</small></span><strong class="danger-text">' + esc(dateBR(task.dueDate)) + '</strong></button>'; }, 'Nenhuma demanda atrasada.') + dashboardListCard('Em aprovação pelo cliente', awaitingApproval, function (post) { return '<button class="dashboard-line" onclick="abrirConteudoAgenda(\'' + esc(post.companyId) + '\',\'' + esc(post.id) + '\')"><span><b>' + esc(post.title) + '</b><small>' + esc(post.companyName || 'Empresa') + '</small></span><strong>' + esc(dateBR(post.date)) + '</strong></button>'; }, 'Nenhum projeto aguardando aprovação.') + dashboardListCard('Demandas atribuídas a parceiros', partnerTasks, function (task) { return '<button class="dashboard-line" onclick="openWorkItem(\'' + esc(task.id) + '\')"><span><b>' + esc(task.title) + '</b><small>' + esc(task.companyName || 'Empresa') + ' · ' + esc(task.partnerName) + ' · ' + esc(task.sourceLabel || 'Tarefa') + '</small></span><strong>' + esc(dateBR(task.dueDate)) + '</strong></button>'; }, 'Nenhuma demanda com parceiro.') + '</div>' +
        (upcoming.length ? '<div class="card" style="margin-top:18px"><div class="card-h"><h3>Próximas entregas</h3><button class="btn btn-ghost" onclick="irPara(\'tarefas\')">Abrir painel dos sócios</button></div>' + upcoming.map(function (task) { return '<div class="lista-item" data-search="' + esc([task.title, task.companyName, task.assignedToName, task.partnerName].join(' ')) + '"><div class="dot-ico" style="background:var(--roxo-claro);color:var(--roxo)">' + ico.clock + '</div><div class="li-body"><div class="li-title">' + esc(task.title) + '</div><div class="li-sub">' + esc(task.companyName || 'Atividade interna') + ' · ' + esc(task.partnerName || task.assignedToName || 'Sem responsável') + '</div></div><span class="li-meta">' + esc(dateBR(task.dueDate)) + '</span><span class="tag ' + (task.displayStatus === 'Atrasado' ? 'tag-vermelho' : 'tag-amarelo') + '">' + esc(task.displayStatus) + '</span></div>'; }).join('') + '</div>' : '');
    } catch (error) { area.innerHTML = empty('Não foi possível carregar o painel', error.message, '<button class="btn btn-primary" onclick="loadDashboard()">Tentar novamente</button>'); }
  }
  window.loadDashboard = loadDashboard;

  function dashboardListCard(title, items, renderer, emptyLabel) {
    return '<section class="card dashboard-list-card"><div class="card-h"><h3>' + esc(title) + '</h3><span class="kb-count">' + items.length + '</span></div>' + (items.length ? items.slice(0, 6).map(renderer).join('') : '<div class="management-inline-empty">' + esc(emptyLabel) + '</div>') + '</section>';
  }

  paginas.agenda = function () {
    window.setTimeout(loadAgenda, 0);
    var readOnly = !canManageAgencyTasks();
    return '<div class="page-head"><div><h1 class="page-title">' + (readOnly ? 'Minha agenda' : 'Agenda de entregas') + '</h1><p class="page-desc">' + (readOnly ? 'Prazos das tarefas e conteúdos atribuídos ao seu perfil ou cadastro de Parceiro PJ' : 'Prazos reais das tarefas e conteúdos da agência') + '</p></div>' + (readOnly ? '' : '<button class="btn btn-primary" onclick="openTaskForm()">+ Nova atividade</button>') + '</div>' +
      '<div class="content-toolbar">' + (readOnly ? '' : '<select id="agenda-company-filter" onchange="renderAgenda()"><option value="">Todas as empresas</option></select><select id="agenda-person-filter" onchange="renderAgenda()"><option value="">Todos os responsáveis</option></select>') + '<select id="agenda-status-filter" onchange="renderAgenda()"><option value="">Todas as situações</option><option>Pendente</option><option>Em andamento</option><option>Atrasado</option><option>Concluído</option></select><button class="btn btn-ghost" onclick="goAgendaToday()">Hoje</button><div class="agenda-nav"><button class="btn btn-ghost" aria-label="Semana anterior" onclick="moveAgenda(-1)">‹</button><button class="btn btn-ghost" aria-label="Próxima semana" onclick="moveAgenda(1)">›</button></div></div>' + loading('agenda-area', readOnly ? 'Carregando sua agenda...' : 'Carregando agenda...');
  };

  async function loadAgenda() {
    var area = document.getElementById('agenda-area'); if (!area) return;
    try {
      if (!canManageAgencyTasks()) {
        var ownPayload = await api('/api/work-items');
        state.tasks = ownPayload.tasks || [];
        state.taskOptionsLoaded = false;
        renderAgenda();
        return;
      }
      var values = await Promise.all([
        api('/api/work-items'),
        state.companies.length ? Promise.resolve({ companies: state.companies }) : api('/api/companies'),
        state.accesses.length ? Promise.resolve({ accesses: state.accesses }) : api('/api/access'),
        state.partners.length ? Promise.resolve({ partners: state.partners }) : api('/api/partners')
      ]);
      state.tasks = values[0].tasks || [];
      state.companies = values[1].companies || state.companies;
      state.accesses = values[2].accesses || state.accesses;
      state.partners = values[3].partners || state.partners;
      state.taskOptionsLoaded = true;
      var companyFilter = document.getElementById('agenda-company-filter');
      var personFilter = document.getElementById('agenda-person-filter');
      if (companyFilter) companyFilter.innerHTML = options(state.companies.map(function (company) { return { value: company.id, label: company.name }; }), companyFilter.value, 'Todas as empresas');
      if (personFilter) personFilter.innerHTML = options(responsibleFilterOptions(), personFilter.value, 'Todos os responsáveis');
      renderAgenda();
    } catch (error) {
      area.innerHTML = empty(canManageAgencyTasks() ? 'Não foi possível abrir a agenda' : 'Não foi possível abrir sua agenda', error.message, '<button class="btn btn-primary" onclick="loadAgenda()">Tentar novamente</button>');
    }
  }
  window.loadAgenda = loadAgenda;

  function agendaWeekStart(value) {
    var date = new Date(value); var day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    date.setHours(0, 0, 0, 0); return date;
  }

  function renderAgenda() {
    var area = document.getElementById('agenda-area'); if (!area) return;
    var companyId = document.getElementById('agenda-company-filter') ? document.getElementById('agenda-company-filter').value : '';
    var personId = document.getElementById('agenda-person-filter') ? document.getElementById('agenda-person-filter').value : '';
    var status = document.getElementById('agenda-status-filter') ? document.getElementById('agenda-status-filter').value : '';
    var readOnly = !canManageAgencyTasks();
    var start = agendaWeekStart(state.agendaCursor); var end = new Date(start); end.setDate(start.getDate() + 6);
    var visible = state.tasks.filter(function (task) {
      return (!companyId || task.tenantId === companyId) && workItemMatchesPerson(task, personId) && (!status || task.displayStatus === status);
    });
    var title = start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' — ' + end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    var today = new Date().toISOString().slice(0, 10);
    var days = '';
    for (var index = 0; index < 7; index += 1) {
      var date = new Date(start); date.setDate(start.getDate() + index);
      var key = date.toISOString().slice(0, 10);
      var tasks = visible.filter(function (task) { return task.dueDate === key; });
      days += '<section class="agenda-day' + (key === today ? ' today' : '') + '"><div class="agenda-day-head"><span>' + esc(date.toLocaleDateString('pt-BR', { weekday: 'short' })) + '</span><b>' + date.getDate() + '</b><small>' + tasks.length + ' atividade' + (tasks.length === 1 ? '' : 's') + '</small></div><div class="agenda-day-body">' +
        (tasks.length ? tasks.map(function (task) {
          var color = task.displayStatus === 'Atrasado' ? '#dc2626' : task.displayStatus === 'Concluído' ? '#16a34a' : task.displayStatus === 'Em andamento' ? '#2563eb' : '#7c3aed';
          var contentItem = task.entityType === 'post';
          var actions = readOnly
            ? ''
            : contentItem
              ? '<div class="agenda-task-actions"><button class="btn-xs" onclick="openWorkItem(\'' + esc(task.id) + '\')">Abrir conteúdo</button></div>'
              : '<div class="agenda-task-actions">' + (task.displayStatus !== 'Concluído' ? '<button class="btn-xs" onclick="completeTask(\'' + esc(task.id) + '\')">Concluir</button>' : '<button class="btn-xs" onclick="reopenTask(\'' + esc(task.id) + '\')">Reabrir</button>') + '<button class="btn-xs" style="color:var(--vermelho)" onclick="deleteTask(\'' + esc(task.id) + '\')">Excluir</button></div>';
          return '<article class="agenda-task" data-search="' + esc([task.title, task.companyName, task.sourceLabel, task.assignedToName, task.partnerName, task.displayStatus].join(' ')) + '" style="border-left-color:' + color + '"><button class="agenda-task-main" onclick="openWorkItem(\'' + esc(task.id) + '\')"><strong>' + esc(task.title) + '</strong><span>' + esc(task.companyName || 'Atividade interna') + ' · ' + esc(task.sourceLabel || 'Tarefa') + '</span><span>' + esc(task.partnerName || task.assignedToName || 'Sem responsável') + ' · ' + esc(task.displayStatus) + (task.scheduledTime ? ' · ' + esc(task.scheduledTime) : '') + '</span></button>' + actions + '</article>';
        }).join('') : '<div class="agenda-empty-day">Sem entregas</div>') + '</div></section>';
    }
    area.innerHTML = '<div class="calendar-shell"><div class="calendar-titlebar"><div><h3>' + esc(title) + '</h3><div class="page-desc">' + visible.length + ' atividade' + (visible.length === 1 ? '' : 's') + ' nos filtros atuais</div></div></div><div class="agenda-week-grid">' + days + '</div></div>';
  }
  window.renderAgenda = renderAgenda;

  function moveAgenda(step) { state.agendaCursor.setDate(state.agendaCursor.getDate() + (step * 7)); renderAgenda(); }
  function goAgendaToday() { state.agendaCursor = new Date(); renderAgenda(); }
  window.moveAgenda = moveAgenda;
  window.goAgendaToday = goAgendaToday;

  function companyCalendarPage(mode) {
    window.setTimeout(loadCompanyCalendar, 0);
    var title = mode === 'partner' ? 'Calendários atribuídos' : 'Calendário geral da empresa';
    var description = mode === 'partner' ? 'Demandas, prazos e arquivos das empresas vinculadas ao seu trabalho' : 'Demandas, conteúdos programados, documentos e arquivos em uma única visão';
    return '<div class="page-head"><div><h1 class="page-title">' + title + '</h1><p class="page-desc">' + description + '</p></div>' + (mode === 'agency' ? '<button class="btn btn-primary" onclick="openTaskForm()">+ Nova demanda</button>' : '') + '</div><div id="company-calendar-area"><div class="loading-state"><div class="spinner"></div>Carregando calendário geral...</div></div>';
  }

  paginas['calendario-empresa'] = function () { return companyCalendarPage('agency'); };
  paginas['c-calendario'] = function () { return companyCalendarPage('client'); };
  paginas['p-dashboard'] = function () { return companyCalendarPage('partner'); };
  paginas['p-prazos'] = function () { return companyCalendarPage('partner'); };
  paginas['p-arquivos'] = function () { return companyCalendarPage('partner'); };

  function abrirCalendarioGeralEmpresa(companyId) {
    state.companyCalendarId = companyId || '';
    state.companyCalendarCursor = new Date();
    irPara('calendario-empresa');
  }
  window.abrirCalendarioGeralEmpresa = abrirCalendarioGeralEmpresa;

  async function loadCompanyCalendar() {
    var area = document.getElementById('company-calendar-area'); if (!area) return;
    try {
      var query = state.companyCalendarId ? '?tenant_id=' + encodeURIComponent(state.companyCalendarId) : '';
      var payload = await api('/api/company-calendar' + query);
      state.companyCalendarEvents = payload.events || [];
      state.companyCalendarCompanies = payload.companies || [];
      state.companyCalendarId = payload.selectedCompanyId || state.companyCalendarId;
      renderCompanyCalendar();
    } catch (error) { area.innerHTML = empty('Não foi possível abrir o calendário geral', error.message, '<button class="btn btn-primary" onclick="loadCompanyCalendar()">Tentar novamente</button>'); }
  }
  window.loadCompanyCalendar = loadCompanyCalendar;

  function renderCompanyCalendar() {
    var area = document.getElementById('company-calendar-area'); if (!area) return;
    var cursor = new Date(state.companyCalendarCursor.getFullYear(), state.companyCalendarCursor.getMonth(), 1);
    var year = cursor.getFullYear(); var month = cursor.getMonth();
    var firstDay = new Date(year, month, 1); var lastDay = new Date(year, month + 1, 0);
    var leading = firstDay.getDay(); var days = '';
    for (var blank = 0; blank < leading; blank += 1) days += '<div class="company-calendar-day muted"></div>';
    for (var day = 1; day <= lastDay.getDate(); day += 1) {
      var key = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var events = state.companyCalendarEvents.filter(function (event) { return event.date === key; });
      days += '<section class="company-calendar-day"><div class="company-calendar-day-head"><b>' + day + '</b><span>' + events.length + '</span></div>' + events.map(companyCalendarEventButton).join('') + '</section>';
    }
    var visibleEvents = state.companyCalendarEvents.filter(function (event) { return String(event.date).slice(0, 7) === year + '-' + String(month + 1).padStart(2, '0'); });
    var companyOptions = state.companyCalendarCompanies.map(function (company) { return { value: company.id, label: company.name }; });
    var toolbar = '<div class="content-toolbar company-calendar-toolbar">' + (companyOptions.length > 1 ? '<select onchange="changeCompanyGeneralCalendar(this.value)">' + options(companyOptions, state.companyCalendarId, 'Todas as empresas atribuídas') + '</select>' : '') + '<button class="btn btn-ghost" onclick="moveCompanyCalendar(-1)">‹ Anterior</button><button class="btn btn-ghost" onclick="goCompanyCalendarToday()">Hoje</button><button class="btn btn-ghost" onclick="moveCompanyCalendar(1)">Próximo ›</button></div>';
    area.innerHTML = toolbar + '<div class="calendar-shell company-calendar-shell"><div class="calendar-titlebar"><div><h3>' + esc(cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })) + '</h3><div class="page-desc">' + visibleEvents.length + ' item' + (visibleEvents.length === 1 ? '' : 's') + ' neste mês</div></div><div class="calendar-legend"><span><i class="legend-task"></i>Demandas</span><span><i class="legend-post"></i>Conteúdos</span></div></div><div class="company-calendar-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="company-calendar-grid">' + days + '</div><div class="company-calendar-mobile-list">' + (visibleEvents.length ? visibleEvents.map(function (event) { return '<div class="company-calendar-mobile-day"><span>' + esc(dateBR(event.date)) + '</span>' + companyCalendarEventButton(event) + '</div>'; }).join('') : '<div class="management-inline-empty">Nenhum item programado neste mês.</div>') + '</div></div>';
  }
  window.renderCompanyCalendar = renderCompanyCalendar;

  function companyCalendarEventButton(event) {
    var action = event.entityType === 'post'
      ? "abrirConteudoAgenda('" + esc(event.companyId) + "','" + esc(event.id) + "')"
      : "openCompanyCalendarEvent('" + esc(event.id) + "','" + esc(event.entityType) + "')";
    return '<button type="button" class="company-calendar-event ' + (event.entityType === 'post' ? 'post-event' : 'task-event') + '" onclick="' + action + '" aria-label="Abrir ' + esc(event.title) + '"><span>' + (event.time ? esc(event.time) + ' · ' : '') + esc(event.title) + '</span><small>' + esc(event.type + ' · ' + event.status) + '</small></button>';
  }

  function moveCompanyCalendar(step) { state.companyCalendarCursor = new Date(state.companyCalendarCursor.getFullYear(), state.companyCalendarCursor.getMonth() + step, 1); renderCompanyCalendar(); }
  function goCompanyCalendarToday() { state.companyCalendarCursor = new Date(); renderCompanyCalendar(); }
  async function changeCompanyGeneralCalendar(id) { state.companyCalendarId = id; await loadCompanyCalendar(); }
  window.moveCompanyCalendar = moveCompanyCalendar; window.goCompanyCalendarToday = goCompanyCalendarToday; window.changeCompanyGeneralCalendar = changeCompanyGeneralCalendar;

  function openCompanyCalendarEvent(id, entityType) {
    var event = state.companyCalendarEvents.find(function (item) { return item.id === id && item.entityType === entityType; }); if (!event) return;
    if (entityType === 'post') {
      showModal(modalHead(event.title) + '<div class="modal-body"><div class="detail-summary"><span class="tag tag-roxo">Conteúdo programado</span><h3>' + esc(event.title) + '</h3><p>' + esc(event.companyName) + ' · ' + esc(dateBR(event.date)) + (event.time ? ' às ' + esc(event.time) : '') + '</p></div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeManagementModal()">Fechar</button><button class="btn btn-primary" onclick="closeManagementModal();abrirConteudoAgenda(\'' + esc(event.companyId) + '\',\'' + esc(event.id) + '\')">Abrir conteúdo completo</button></div></div>', false);
      return;
    }
    var files = event.files || [];
    var actorRole = state.session && state.session.actor ? state.session.actor.role : '';
    var actorId = state.session && state.session.actor ? state.session.actor.id : '';
    var canAdmin = ['super_admin', 'socio'].includes(actorRole);
    var canEditAssigned = ['colaborador', 'parceiro'].includes(actorRole);
    var fileRows = files.length ? files.map(function (file) {
      var canDelete = canAdmin || (file.uploadedBy && file.uploadedBy === actorId);
      return '<div class="file-row"><div class="file-main"><b>' + esc(file.fileName) + '</b><span>' + esc(formatFileSize(file.fileSize)) + '</span></div><div class="management-actions"><a class="btn-xs" href="' + esc(file.previewUrl) + '" target="_blank" rel="noopener">Abrir</a><a class="btn-xs" href="' + esc(file.downloadUrl) + '">Baixar</a>' + (canDelete ? '<button class="btn-xs" style="color:var(--vermelho)" onclick="deleteTaskFile(\'' + esc(file.id) + '\',\'' + esc(event.id) + '\')">Excluir</button>' : '') + '</div></div>';
    }).join('') : '<div class="management-inline-empty">Nenhum arquivo anexado ainda.</div>';
    var assignedEditor = canEditAssigned ? '<form onsubmit="saveAssignedCalendarTask(event,\'' + esc(event.id) + '\')"><section class="form-section"><div class="form-section-title">Descrição e andamento</div><div class="form-section-desc">Atualize a execução da demanda atribuída ao seu perfil.</div><div class="form-grid">' + field('Situação', '<select name="status">' + options(['Pendente', 'Em andamento', 'Atrasado', 'Concluído'], event.status) + '</select>') + field('Descrição', '<textarea name="description">' + esc(event.description || '') + '</textarea>', true) + '</div><div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-primary" type="submit">Salvar andamento</button></div></section></form>' : '';
    showModal(modalHead(event.title) + '<div class="modal-body"><div class="detail-summary"><span class="tag tag-azul">Demanda</span><h3>' + esc(event.title) + '</h3><p>' + esc(event.companyName) + ' · entrega em ' + esc(dateBR(event.date)) + '</p>' + (canEditAssigned ? '' : '<p class="page-desc">' + esc(event.description || 'Sem observações adicionais.') + '</p>') + '</div>' + assignedEditor + '<section class="form-section"><div class="form-section-title">Arquivos da demanda</div><div class="form-section-desc">Documentos e materiais ficam vinculados somente a esta empresa.</div><div class="file-list">' + fileRows + '</div></section><form onsubmit="uploadTaskFiles(event,\'' + esc(event.id) + '\')"><label class="upload-zone upload-zone-active"><span class="upload-icon">' + ico.upload + '</span><b>Anexar documentos ou arquivos</b><span>Os originais são preservados sem compressão</span><input name="files" type="file" multiple required></label><div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Fechar</button><button class="btn btn-primary" type="submit">Enviar arquivos</button></div></form></div>', true);
  }
  window.openCompanyCalendarEvent = openCompanyCalendarEvent;

  async function saveAssignedCalendarTask(event, taskId) {
    event.preventDefault(); var button = event.currentTarget.querySelector('button[type="submit"]'); var data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (button) { button.disabled = true; button.textContent = 'Salvando...'; }
    try { await api('/api/tasks/' + encodeURIComponent(taskId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); toast('Demanda atualizada.'); closeManagementModal(); await loadCompanyCalendar(); openCompanyCalendarEvent(taskId, 'task'); } catch (error) { toast(error.message, true); if (button) { button.disabled = false; button.textContent = 'Salvar andamento'; } }
  }
  window.saveAssignedCalendarTask = saveAssignedCalendarTask;

  async function uploadTaskFiles(event, taskId) {
    event.preventDefault(); var button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Enviando...';
    try { var form = new FormData(event.currentTarget); form.append('task_id', taskId); await api('/api/task-files', { method: 'POST', body: form }); toast('Arquivos anexados à demanda.'); closeManagementModal(); await loadCompanyCalendar(); openCompanyCalendarEvent(taskId, 'task'); } catch (error) { toast(error.message, true); button.disabled = false; button.textContent = 'Enviar arquivos'; }
  }
  window.uploadTaskFiles = uploadTaskFiles;

  async function deleteTaskFile(fileId, taskId) {
    if (!window.confirm('Excluir este arquivo?')) return;
    try { await api('/api/task-files?id=' + encodeURIComponent(fileId), { method: 'DELETE' }); toast('Arquivo excluído.'); closeManagementModal(); await loadCompanyCalendar(); openCompanyCalendarEvent(taskId, 'task'); } catch (error) { toast(error.message, true); }
  }
  window.deleteTaskFile = deleteTaskFile;

  paginas.backups = function () {
    window.setTimeout(loadBackups, 0);
    return '<div class="page-head"><div><h1 class="page-title">Backup completo</h1><p class="page-desc">Proteja todos os dados, conversas e arquivos originais da Óriva</p></div><button id="create-backup-button" class="btn btn-primary" onclick="createBackup()">Gerar backup completo</button></div>' +
      '<div class="backup-security-note">' + ico.backup + '<div><b>Acesso exclusivo do administrador principal</b><span>Só o superadministrador pode gerar, consultar ou baixar estes arquivos. Senhas e credenciais do Supabase Auth nunca entram no backup.</span></div></div>' +
      '<div class="backup-info-grid"><section class="card backup-info-card"><h3>O que entra na cópia</h3><p>Empresas, usuários, tarefas, calendários, conteúdos, comentários, contratos, financeiro, leads, chats, mensagens e todo o histórico operacional.</p><ul><li>Dados organizados em JSON</li><li>Fotos, imagens, vídeos, PDFs e demais anexos</li><li>Histórico de cada geração dentro da plataforma</li></ul></section><section class="card backup-info-card"><h3>Recuperação segura</h3><p>O botão Restaurar recupera somente registros e arquivos que estiverem ausentes. Informações atuais nunca são apagadas nem substituídas.</p><ul><li>Validação antes de alterar o banco</li><li>Confirmação escrita para evitar toque acidental</li><li>Histórico de todas as restaurações</li></ul></section></div>' +
      loading('backups-area', 'Carregando histórico de backups...');
  };

  function backupStatusLabel(value) {
    return ({ processando: 'Processando', concluido: 'Concluído', falhou: 'Falhou' })[value] || value || 'Desconhecido';
  }

  function backupStatusClass(value) {
    return value === 'concluido' ? 'tag-verde' : value === 'falhou' ? 'tag-vermelho' : 'tag-amarelo';
  }

  function restoreStatusLabel(value) {
    return ({ processando: 'Processando', concluido: 'Concluída', parcial: 'Parcial', falhou: 'Falhou' })[value] || value || 'Desconhecido';
  }

  function restoreStatusClass(value) {
    return value === 'concluido' ? 'tag-verde' : value === 'falhou' ? 'tag-vermelho' : 'tag-amarelo';
  }

  function restoreHistory() {
    if (!state.restores.length) return '<section class="card" style="margin-top:18px"><div class="card-h"><h3>Histórico de restaurações</h3></div><div class="management-inline-empty">Nenhuma restauração realizada ainda.</div></section>';
    return '<section style="margin-top:20px"><div class="card-h"><div><h3>Histórico de restaurações</h3><p class="page-desc">Registro das recuperações feitas pelo administrador principal</p></div></div><div class="tbl-wrap"><table class="responsive-table"><thead><tr><th>Executada em</th><th>Responsável</th><th>Situação</th><th>Recuperado</th><th>Observação</th></tr></thead><tbody>' + state.restores.map(function (item) {
      var requester = item.requestedBy || {};
      return '<tr><td data-label="Executada em"><b>' + esc(dateTimeBR(item.completedAt || item.createdAt)) + '</b></td><td data-label="Responsável">' + esc(requester.name || requester.email || 'Administrador principal') + '</td><td data-label="Situação"><span class="tag ' + restoreStatusClass(item.status) + '">' + esc(restoreStatusLabel(item.status)) + '</span></td><td data-label="Recuperado">' + esc(String(item.recordsRestored || 0)) + ' registros<div class="li-sub">' + esc(String(item.filesRestored || 0)) + ' arquivos recuperados · ' + esc(String(item.filesSkipped || 0)) + ' já existentes</div></td><td data-label="Observação"><span class="li-sub">' + esc(item.errorMessage || 'Concluída sem alterar informações atuais.') + '</span></td></tr>';
    }).join('') + '</tbody></table></div></section>';
  }

  async function loadBackups() {
    var area = document.getElementById('backups-area'); if (!area) return;
    try {
      var payload = await api('/api/backups');
      state.backups = payload.backups || [];
      state.restores = payload.restores || [];
      var completed = state.backups.filter(function (item) { return item.status === 'concluido'; });
      var latest = completed[0];
      var summary = '<div class="grid g-3" style="margin-bottom:18px">' +
        kpi('backup', String(completed.length), 'Backups concluídos') +
        kpi('clock', latest ? dateTimeBR(latest.completedAt || latest.createdAt) : 'Nenhum', 'Último backup') +
        kpi('tarefas', latest ? String(latest.recordCount || 0) + ' registros · ' + String(latest.storageFileCount || 0) + ' arquivos' : '0', 'Itens na última cópia') + '</div>';
      if (!state.backups.length) {
        area.innerHTML = summary + empty('Nenhum backup gerado ainda', 'Crie a primeira cópia segura dos dados da Óriva.', '<button class="btn btn-primary" onclick="createBackup()">Gerar primeiro backup</button>');
        return;
      }
      area.innerHTML = summary + '<div class="tbl-wrap"><table class="responsive-table"><thead><tr><th>Gerado em</th><th>Responsável</th><th>Situação</th><th>Conteúdo</th><th>Tamanho</th><th>Ações</th></tr></thead><tbody>' + state.backups.map(function (item) {
        var creator = item.createdBy || {};
        var action = item.fullDownloadUrl
          ? '<div class="management-actions"><button class="btn-xs" onclick="openRestoreBackup(\'' + esc(item.id) + '\')">Restaurar</button><button class="btn-xs" onclick="downloadBackup(\'' + esc(item.id) + '\',\'' + esc(item.archiveFileName || 'oriva-backup-completo.zip') + '\',\'complete\')">Baixar tudo (.zip)</button><button class="btn-xs" onclick="downloadBackup(\'' + esc(item.id) + '\',\'' + esc(item.fileName || 'oriva-backup.json') + '\',\'json\')">Baixar dados (.json)</button></div>'
          : item.downloadUrl ? '<button class="btn-xs" onclick="downloadBackup(\'' + esc(item.id) + '\',\'' + esc(item.fileName || 'oriva-backup.json') + '\',\'json\')">Baixar JSON</button>' : '<span class="li-sub">' + esc(item.errorMessage || 'Aguardando conclusão') + '</span>';
        var content = item.format === 'completo' ? String(item.recordCount || 0) + ' registros<div class="li-sub">' + String(item.storageFileCount || 0) + ' arquivos originais</div>' : String(item.recordCount == null ? '—' : item.recordCount) + ' registros<div class="li-sub">Backup antigo: somente dados</div>';
        return '<tr><td data-label="Gerado em"><b>' + esc(dateTimeBR(item.createdAt)) + '</b><div class="li-sub">' + esc(item.archiveFileName || item.fileName || 'Preparando arquivo') + '</div></td><td data-label="Responsável">' + esc(creator.name || creator.email || 'Administrador principal') + '</td><td data-label="Situação"><span class="tag ' + backupStatusClass(item.status) + '">' + esc(backupStatusLabel(item.status)) + '</span></td><td data-label="Conteúdo">' + content + '</td><td data-label="Tamanho">' + esc(item.totalSize == null ? '—' : formatFileSize(item.totalSize)) + '</td><td data-label="Ações">' + action + '</td></tr>';
      }).join('') + '</tbody></table></div>' + restoreHistory();
    } catch (error) {
      area.innerHTML = empty('Não foi possível abrir os backups', error.message, '<button class="btn btn-primary" onclick="loadBackups()">Tentar novamente</button>');
    }
  }
  window.loadBackups = loadBackups;

  async function createBackup() {
    if (currentActorRole() !== 'super_admin') { toast('Apenas o administrador principal pode gerar backups.', true); return; }
    if (!window.confirm('Gerar agora uma cópia completa dos dados, mensagens e arquivos originais? Nenhum cadastro será alterado.')) return;
    var button = document.getElementById('create-backup-button');
    if (button) { button.disabled = true; button.textContent = 'Copiando dados e arquivos...'; }
    try {
      var payload = await api('/api/backups', { method: 'POST' });
      toast('Backup concluído: ' + String(payload.backup.recordCount || 0) + ' registros e ' + String(payload.backup.storageFileCount || 0) + ' arquivos.');
      await loadBackups();
    } catch (error) {
      toast(error.message, true);
      await loadBackups();
    } finally {
      button = document.getElementById('create-backup-button');
      if (button) { button.disabled = false; button.textContent = 'Gerar backup completo'; }
    }
  }
  window.createBackup = createBackup;

  function openRestoreBackup(id) {
    var backup = state.backups.find(function (item) { return item.id === id; });
    if (!backup || backup.status !== 'concluido' || backup.format !== 'completo') { toast('Este backup não está disponível para restauração.', true); return; }
    showModal(modalHead('Restaurar informações') + '<form onsubmit="restoreBackup(event,\'' + esc(id) + '\')"><div class="modal-body"><div class="detail-summary"><span class="tag tag-amarelo">Recuperação segura</span><h3>Backup de ' + esc(dateTimeBR(backup.createdAt)) + '</h3><p>' + esc(String(backup.recordCount || 0)) + ' registros · ' + esc(String(backup.storageFileCount || 0)) + ' arquivos no pacote</p></div><section class="form-section"><div class="form-section-title">O que acontecerá</div><div class="form-section-desc">O sistema recuperará somente registros, mensagens e arquivos originais que estiverem ausentes. Dados criados ou alterados depois deste backup não serão apagados nem substituídos.</div></section><section class="form-section"><div class="form-section-title">Antes de continuar</div><div class="form-section-desc">Os logins precisam continuar cadastrados no Supabase Auth. As senhas não fazem parte do backup e permanecem protegidas.</div><div class="form-grid" style="margin-top:12px">' + field('Digite RESTAURAR para confirmar', '<input name="confirmation" autocomplete="off" placeholder="RESTAURAR" required>', true, 'Essa confirmação evita uma restauração por toque acidental.') + '</div></section></div><div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeManagementModal()">Cancelar</button><button id="restore-backup-button" class="btn btn-primary" type="submit">Restaurar itens ausentes</button></div></form>', true);
  }
  window.openRestoreBackup = openRestoreBackup;

  async function restoreBackup(event, id) {
    event.preventDefault();
    var button = document.getElementById('restore-backup-button');
    var confirmation = String(new FormData(event.currentTarget).get('confirmation') || '').trim();
    if (confirmation.toUpperCase() !== 'RESTAURAR') { toast('Digite RESTAURAR exatamente como solicitado.', true); return; }
    if (button) { button.disabled = true; button.textContent = 'Recuperando informações...'; }
    try {
      var payload = await api('/api/backups/' + encodeURIComponent(id) + '/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: confirmation }) });
      var result = payload.restore || {};
      closeManagementModal();
      toast((payload.message || 'Restauração concluída.') + ' ' + String(result.recordsRestored || 0) + ' registros e ' + String(result.filesRestored || 0) + ' arquivos recuperados.', result.status === 'parcial');
      await loadBackups();
    } catch (error) {
      toast(error.message, true);
      if (button) { button.disabled = false; button.textContent = 'Restaurar itens ausentes'; }
    }
  }
  window.restoreBackup = restoreBackup;

  async function fetchBackupDownload(url, retried) {
    var response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401 && !retried) {
      var refreshed = await window.orivaRefreshSession();
      if (refreshed.ok) return fetchBackupDownload(url, true);
    }
    return response;
  }

  async function downloadBackup(id, fileName, format) {
    try {
      var selectedFormat = format === 'complete' ? 'complete' : 'json';
      var downloadUrl = '/api/backups/' + encodeURIComponent(id) + '/download?format=' + selectedFormat;
      if (selectedFormat === 'complete') {
        var refreshed = await window.orivaRefreshSession();
        if (!refreshed.ok) throw new Error('Sua sessão expirou. Entre novamente para baixar o backup.');
        var directLink = document.createElement('a'); directLink.href = downloadUrl; directLink.download = fileName || 'oriva-backup-completo.zip';
        document.body.appendChild(directLink); directLink.click(); directLink.remove();
        toast('Download do backup completo iniciado. Arquivos grandes podem levar alguns minutos.');
        return;
      }
      var response = await fetchBackupDownload(downloadUrl, false);
      if (!response.ok) {
        var payload = {}; try { payload = await response.json(); } catch {}
        throw new Error(translateMessage(payload.error, 'Não foi possível baixar o backup.'));
      }
      var url = URL.createObjectURL(await response.blob());
      var link = document.createElement('a'); link.href = url; link.download = fileName || 'oriva-backup.json';
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      toast('Download do backup iniciado.');
    } catch (error) { toast(error.message, true); }
  }
  window.downloadBackup = downloadBackup;

  paginas.relatorios = function () {
    window.setTimeout(loadReports, 0);
    return '<div class="page-head"><div><h1 class="page-title">Relatórios</h1><p class="page-desc">Resumo operacional e financeiro com dados persistidos</p></div></div>' + loading('reports-real-area', 'Gerando relatório...');
  };

  async function loadReports() {
    var area = document.getElementById('reports-real-area'); if (!area) return;
    try {
      var report = await api('/api/reports');
      area.innerHTML = '<div class="grid g-4 report-kpis" style="margin-bottom:18px">' + kpi('clientes', String(report.clientsActive), 'Clientes ativos', '', '', "irPara('clientes')") + kpi('trend', String(report.clientsNewMonth), 'Clientes novos no mês', '', '', "irPara('clientes')") + kpi('clock', String(report.clientsLostMonth), 'Clientes perdidos no mês', '', '', "irPara('clientes')") + kpi('parceiros', String(report.leads), 'Leads em acompanhamento', '', '', "irPara('clientes')") + '</div><div class="grid g-3" style="margin-bottom:24px">' + kpi('tarefas', String(report.tasksOpen), 'Demandas abertas', '', '', "irPara('tarefas')") + kpi('check', String(report.tasksCompleted), 'Demandas concluídas', '', '', "irPara('tarefas')") + kpi('clock', String(report.tasksOverdue), 'Demandas atrasadas', '', '', "irPara('tarefas')") + '</div><div class="report-lists-grid">' + reportRanking('Demandas abertas por parceiro', report.tasksByPartner, "irPara('tarefas')") + reportRanking('Entregas realizadas por parceiro', report.deliveriesByPartner, "irPara('tarefas')") + reportRanking('Conteúdos entregues por cliente', report.deliveriesByClient, "irPara('calendario-posts')") + '</div>';
    } catch (error) { area.innerHTML = empty('Não foi possível gerar o relatório', error.message, '<button class="btn btn-primary" onclick="loadReports()">Tentar novamente</button>'); }
  }
  window.loadReports = loadReports;

  function reportRanking(title, rows, action) {
    rows = rows || [];
    return '<section class="card report-ranking"><div class="card-h"><h3>' + esc(title) + '</h3>' + (action ? '<button class="btn btn-ghost" onclick="' + esc(action) + '">Abrir</button>' : '') + '</div>' + (rows.length ? rows.map(function (row, index) { return '<div class="ranking-row"><span class="ranking-position">' + (index + 1) + '</span><div><b>' + esc(row.name) + '</b><small>' + row.count + ' registro' + (row.count === 1 ? '' : 's') + '</small></div><strong>' + row.count + '</strong></div>'; }).join('') : '<div class="management-inline-empty">Ainda não há dados para este indicador.</div>') + '</section>';
  }

  paginas['c-dashboard'] = function () {
    window.setTimeout(loadClientDashboard, 0);
    return '<div class="page-head"><div><h1 class="page-title">Visão geral</h1><p class="page-desc">Conteúdos, demandas e arquivos da sua empresa</p></div><div class="management-actions"><button class="btn btn-ghost" onclick="irPara(\'c-calendario\')">Calendário da empresa</button><button class="btn btn-primary" onclick="irPara(\'c-conteudo\')">Conteúdos e arquivos</button></div></div>' + loading('client-dashboard-real-area', 'Carregando seus conteúdos...');
  };

  async function loadClientDashboard() {
    var area = document.getElementById('client-dashboard-real-area'); if (!area) return;
    try {
      var companyPayload = await api('/api/companies'); var companies = companyPayload.companies || []; var company = companies[0]; if (!company) { area.innerHTML = empty('Nenhuma empresa vinculada', 'Peça à agência para verificar seu acesso.', ''); return; }
      var postPayload = await api('/api/posts?tenant_id=' + encodeURIComponent(company.id)); var posts = postPayload.posts || []; var awaiting = posts.filter(function (post) { return post.status === 'Aguardando aprovação'; }); var approved = posts.filter(function (post) { return post.status === 'Aprovado'; }); var upcoming = posts.filter(function (post) { return post.scheduledDate >= new Date().toISOString().slice(0, 10); }).slice(0, 5);
      area.innerHTML = '<div class="perfil-banner"><div><h2>' + esc(company.name) + '</h2><p>Seu calendário é privado e vinculado somente à sua empresa.</p></div></div><div class="grid g-3" style="margin-bottom:20px">' + kpi('agenda', String(posts.length), 'Conteúdos disponíveis') + kpi('clock', String(awaiting.length), 'Aguardando aprovação') + kpi('check', String(approved.length), 'Aprovados') + '</div>' + (upcoming.length ? '<div class="card"><div class="card-h"><h3>Próximos conteúdos</h3></div>' + upcoming.map(function (post) { return '<div class="lista-item"><div class="dot-ico" style="background:var(--roxo-claro);color:var(--roxo)">' + ico.agenda + '</div><div class="li-body"><div class="li-title">' + esc(post.title) + '</div><div class="li-sub">' + esc(post.contentType + ' · ' + post.socialNetwork) + '</div></div><span class="li-meta">' + esc(dateBR(post.scheduledDate) + ' · ' + post.scheduledTime) + '</span><span class="tag tag-roxo">' + esc(post.status) + '</span></div>'; }).join('') + '</div>' : empty('Ainda não há conteúdos programados', 'Assim que a agência preparar um conteúdo, ele aparecerá aqui.', ''));
    } catch (error) { area.innerHTML = empty('Não foi possível carregar seus conteúdos', error.message, '<button class="btn btn-primary" onclick="loadClientDashboard()">Tentar novamente</button>'); }
  }
  window.loadClientDashboard = loadClientDashboard;

  paginas['c-materiais'] = function () { return paginas['c-conteudo'](); };
  paginas['c-entregas'] = function () { var html = paginas['c-conteudo'](); window.setTimeout(function () { if (window.changeCalendarView) window.changeCalendarView('list'); }, 250); return html; };

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeManagementModal();
  });
})();
