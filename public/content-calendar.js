(function () {
  'use strict';

  var contentState = {
    posts: [],
    companies: [],
    team: [],
    partners: [],
    tenantId: '',
    pendingPostId: '',
    clientMode: false,
    restrictedMode: false,
    permissions: { canManage: false, canReview: true, canEditAssigned: false, canAttach: false },
    pendingFiles: [],
    view: 'month',
    cursor: new Date(),
    filters: { status: '', content_type: '', social_network: '' }
  };

  var contentTypes = ['Post', 'Carrossel', 'Stories', 'Reels', 'Vídeo', 'Arte', 'Campanha', 'Outro'];
  var networks = ['Instagram', 'TikTok', 'Facebook', 'LinkedIn', 'YouTube Shorts', 'Outra'];
  var statuses = ['Rascunho', 'Programado', 'Aguardando aprovação', 'Aprovado', 'Revisão solicitada', 'Publicado'];
  var statusColors = {
    'Rascunho': '#8b8b95',
    'Programado': '#2563eb',
    'Aguardando aprovação': '#d97706',
    'Aprovado': '#16a34a',
    'Revisão solicitada': '#dc2626',
    'Publicado': '#7c3aed'
  };
  var companySlugs = {};
  var lastResponsiveMode = '';

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
      [/failed to fetch|fetch failed|network request failed|load failed/i, 'Não foi possível conectar ao sistema. Verifique sua internet e tente novamente.'],
      [/permission denied|unauthorized|forbidden/i, 'Você não tem permissão para realizar esta ação.']
    ];
    for (var index = 0; index < translations.length; index += 1) {
      if (translations[index][0].test(message)) return translations[index][1];
    }
    return message || standard;
  }

  function slugEmpresa(name) {
    return companySlugs[name] || String(name).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  window.slugEmpresa = slugEmpresa;

  function companyName() {
    var company = contentState.companies.find(function (item) {
      return item.id === contentState.tenantId;
    });
    return company ? company.name : 'Empresa';
  }

  function dateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function parseDate(key) {
    var parts = String(key).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatDate(key, options) {
    if (!key) return '';
    return parseDate(key).toLocaleDateString('pt-BR', options || {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  function formatBytes(value) {
    var bytes = Number(value || 0);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function options(items, selected, placeholder) {
    var html = placeholder == null ? '' : '<option value="">' + esc(placeholder) + '</option>';
    return html + items.map(function (item) {
      return '<option value="' + esc(item) + '"' + (item === selected ? ' selected' : '') + '>' + esc(item) + '</option>';
    }).join('');
  }

  function currentActor() {
    return window.orivaCurrentActor || {};
  }

  function isAssignedContentMode() {
    var role = currentActor().role;
    return role === 'colaborador' || role === 'parceiro';
  }

  function calendarShell(clientMode) {
    contentState.clientMode = clientMode;
    contentState.restrictedMode = !clientMode && isAssignedContentMode();
    window.setTimeout(initContentCalendar, 0);
    var visibleStatuses = clientMode ? statuses.filter(function (status) { return status !== 'Rascunho'; }) : statuses;
    var clientIntro = clientMode ? [
      '<div class="manual-post-banner">',
        '<div style="display:flex;align-items:center;gap:14px"><div class="manual-post-shield">🔒</div><div>',
          '<h3>Publique com segurança, sem compartilhar suas senhas</h3>',
          '<p>A Óriva nunca pede seu login do Instagram, TikTok ou Facebook. Baixe o arquivo pronto, copie a legenda e publique manualmente no horário indicado.</p>',
        '</div></div>',
        '<span class="tag" style="background:rgba(255,255,255,.12);color:#fff">100% dentro do site</span>',
      '</div>',
      '<div class="manual-steps">',
        '<div class="manual-step"><div class="manual-step-num">1</div><div><b>Abra o conteúdo</b><span>Confira arte, vídeo e horário</span></div></div>',
        '<div class="manual-step"><div class="manual-step-num">2</div><div><b>Baixe e copie</b><span>Arquivo original e legenda pronta</span></div></div>',
        '<div class="manual-step"><div class="manual-step-num">3</div><div><b>Publique manualmente</b><span>Use sua própria conta com segurança</span></div></div>',
      '</div>'
    ].join('') : '';
    var title = clientMode ? 'Conteúdos e arquivos' : contentState.restrictedMode ? 'Meus conteúdos' : 'Calendário de Posts';
    var description = clientMode ? 'Veja, aprove, baixe os arquivos originais e copie as legendas preparadas pela Óriva' : contentState.restrictedMode ? 'Visualize e atualize somente os conteúdos atribuídos ao seu perfil' : 'Organize, visualize, aprove e baixe todos os conteúdos da empresa';
    return [
      '<div class="page-head">',
        '<div><h1 class="page-title">' + title + '</h1>',
        '<p class="page-desc">' + description + '</p></div>',
        contentState.restrictedMode || clientMode ? '' : '<button id="new-content-main" class="btn btn-primary" onclick="openContentForm()">+ Novo conteúdo</button>',
      '</div>',
      clientIntro,
      '<div class="content-toolbar">',
        '<select id="company-filter" class="grow" aria-label="Empresa" onchange="changeContentCompany(this.value)"></select>',
        '<select id="status-filter" aria-label="Filtrar por situação" onchange="changeContentFilter(\'status\',this.value)">',
          options(visibleStatuses, '', 'Todas as situações'),
        '</select>',
        '<select id="type-filter" aria-label="Filtrar por tipo" onchange="changeContentFilter(\'content_type\',this.value)">',
          options(contentTypes, '', 'Todos os tipos'),
        '</select>',
        '<select id="network-filter" aria-label="Filtrar por rede" onchange="changeContentFilter(\'social_network\',this.value)">',
          options(networks, '', 'Todas as redes'),
        '</select>',
        '<div class="view-switch">',
          '<button class="view-btn ativo" data-view="month" onclick="changeCalendarView(\'month\')">Mês</button>',
          '<button class="view-btn" data-view="week" onclick="changeCalendarView(\'week\')">Semana</button>',
          '<button class="view-btn" data-view="list" onclick="changeCalendarView(\'list\')">Próximos</button>',
        '</div>',
      '</div>',
      '<div id="content-calendar-area"><div class="loading-state"><div class="spinner"></div>Carregando calendário...</div></div>'
    ].join('');
  }

  paginas['calendario-posts'] = function () { return calendarShell(false); };
  paginas['c-conteudo'] = function () { return calendarShell(true); };

  function abrirCalendarioEmpresa(tenantId) {
    contentState.tenantId = tenantId;
    contentState.pendingPostId = '';
    irPara('calendario-posts');
  }
  window.abrirCalendarioEmpresa = abrirCalendarioEmpresa;

  function abrirConteudoAgenda(tenantId, postId) {
    contentState.tenantId = tenantId;
    contentState.pendingPostId = postId;
    contentState.filters = { status: '', content_type: '', social_network: '' };
    var actor = currentActor();
    irPara(actor.role === 'empresa_cliente' ? 'c-conteudo' : 'calendario-posts');
  }
  window.abrirConteudoAgenda = abrirConteudoAgenda;

  function bindContentCalendarInteractions(area) {
    if (!area || area.dataset.contentInteractionsBound === 'true') return;
    area.dataset.contentInteractionsBound = 'true';
    area.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-content-post-id]');
      if (!trigger || !area.contains(trigger)) return;
      event.preventDefault();
      openContentDetails(trigger.dataset.contentPostId);
    });
  }

  function contentOpenAttributes(postId, label) {
    return ' type="button" data-content-post-id="' + esc(postId) + '" aria-label="' + esc(label || 'Abrir conteúdo') + '"';
  }

  async function apiJson(url, options, retried) {
    var response;
    try {
      response = await fetch(url, options || {});
    } catch (error) {
      throw new Error(translateMessage(error && error.message, 'Não foi possível conectar ao sistema. Verifique sua internet e tente novamente.'));
    }
    if (response.status === 401 && !retried) {
      var refreshed = await window.orivaRefreshSession();
      if (refreshed.ok) return apiJson(url, options, true);
    }
    var payload = {};
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (!response.ok) throw new Error(translateMessage(payload.error, 'Não foi possível concluir a operação.'));
    return payload;
  }

  async function initContentCalendar() {
    var area = document.getElementById('content-calendar-area');
    if (!area) return;
    lastResponsiveMode = responsiveCalendarMode();
    bindContentCalendarInteractions(area);
    try {
      var payload = await apiJson('/api/companies');
      contentState.companies = payload.companies || [];
      if (!contentState.clientMode && !contentState.restrictedMode) {
        contentState.companies = contentState.companies.filter(function (company) {
          return String(company.relationshipType || 'Cliente').toLowerCase() !== 'lead';
        });
      }
      if (!contentState.clientMode && !contentState.restrictedMode) {
        try {
          var accessPayload = await apiJson('/api/access');
          contentState.team = (accessPayload.accesses || []).filter(function (access) {
            return access.status === 'Ativo' && (access.role === 'agency_owner' || access.role === 'agency_member' || access.role === 'collaborator');
          });
          contentState.partners = (accessPayload.partners || []).filter(function (partner) {
            return partner.status === 'ativo';
          });
        } catch (ignored) { contentState.team = []; contentState.partners = []; }
      }
      if (contentState.companies.length && !contentState.companies.some(function (company) {
        return company.id === contentState.tenantId;
      })) {
        contentState.tenantId = contentState.companies[0].id;
      }
      renderCompanySelector();
      if (!contentState.companies.length) {
        if (contentState.restrictedMode) {
          area.innerHTML = '<div class="empty-state"><div class="empty-icon">' + ico.material + '</div><h3>Nenhum conteúdo atribuído a você.</h3><p>Quando um sócio atribuir um conteúdo ao seu perfil, ele aparecerá aqui.</p></div>';
        } else {
          area.innerHTML = '<div class="empty-state"><div class="empty-icon">+</div><h3>Nenhuma empresa cadastrada ainda.</h3><p>Cadastre uma empresa para criar seu calendário exclusivo e o login do cliente.</p>' + (!contentState.clientMode ? '<button class="btn btn-primary" onclick="irPara(\'clientes\')">Cadastrar primeira empresa</button>' : '') + '</div>';
        }
        return;
      }
      await loadContentPosts();
    } catch (error) {
      renderCalendarError(error.message);
    }
  }

  function renderCompanySelector() {
    var select = document.getElementById('company-filter');
    if (!select) return;
    select.innerHTML = contentState.companies.map(function (company) {
      return '<option value="' + esc(company.id) + '"' +
        (company.id === contentState.tenantId ? ' selected' : '') + '>' +
        esc(company.name) + '</option>';
    }).join('');
    if (contentState.clientMode) {
      select.disabled = true;
      select.title = 'Acesso restrito à sua empresa';
    }
  }

  function changeContentCompany(value) {
    contentState.tenantId = value;
    loadContentPosts();
  }
  window.changeContentCompany = changeContentCompany;

  function changeContentFilter(key, value) {
    contentState.filters[key] = value;
    loadContentPosts();
  }
  window.changeContentFilter = changeContentFilter;

  async function loadContentPosts() {
    var area = document.getElementById('content-calendar-area');
    if (!area) return;
    area.innerHTML = '<div class="loading-state"><div class="spinner"></div>Carregando conteúdos...</div>';
    var params = new URLSearchParams({ tenant_id: contentState.tenantId });
    Object.keys(contentState.filters).forEach(function (key) {
      if (contentState.filters[key]) params.set(key, contentState.filters[key]);
    });
    try {
      var payload = await apiJson('/api/posts?' + params.toString());
      contentState.posts = payload.posts || [];
      if (contentState.clientMode) {
        contentState.posts = contentState.posts.filter(function (post) {
          return post.status !== 'Rascunho';
        }).map(function (post) {
          var safe = Object.assign({}, post);
          delete safe.internalNotes;
          return safe;
        });
      }
      contentState.permissions = payload.permissions || { canManage: false, canReview: true };
      if (contentState.clientMode) contentState.permissions.canManage = false;
      var button = document.getElementById('new-content-main');
      if (button) button.style.display = contentState.permissions.canManage ? 'inline-flex' : 'none';
      if (contentState.pendingPostId) {
        var pendingId = contentState.pendingPostId;
        contentState.pendingPostId = '';
        var pendingPost = contentState.posts.find(function (post) { return post.id === pendingId; });
        if (pendingPost) {
          contentState.cursor = parseDate(pendingPost.scheduledDate);
          renderContentCalendar();
          window.setTimeout(function () { openContentDetails(pendingId); }, 0);
          return;
        }
      }
      renderContentCalendar();
    } catch (error) {
      renderCalendarError(error.message);
    }
  }

  function renderCalendarError(message) {
    var area = document.getElementById('content-calendar-area');
    if (!area) return;
    area.innerHTML = [
      '<div class="empty-state">',
        '<div class="empty-icon">!</div>',
        '<h3>Não foi possível abrir o calendário</h3>',
        '<p>' + esc(message) + '</p>',
        '<button class="btn btn-primary" onclick="loadContentPosts()">Tentar novamente</button>',
      '</div>'
    ].join('');
  }
  window.loadContentPosts = loadContentPosts;

  function changeCalendarView(view) {
    contentState.view = view;
    document.querySelectorAll('.view-btn').forEach(function (button) {
      button.classList.toggle('ativo', button.dataset.view === view);
    });
    renderContentCalendar();
  }
  window.changeCalendarView = changeCalendarView;

  function moveCalendar(step) {
    if (contentState.view === 'week') {
      contentState.cursor.setDate(contentState.cursor.getDate() + (step * 7));
    } else {
      contentState.cursor = new Date(contentState.cursor.getFullYear(), contentState.cursor.getMonth() + step, 1);
    }
    renderContentCalendar();
  }
  window.moveCalendar = moveCalendar;

  function goToday() {
    contentState.cursor = new Date();
    renderContentCalendar();
  }
  window.goToday = goToday;

  function emptyState() {
    var title = contentState.clientMode ? 'A agência ainda não liberou conteúdos para você.' : contentState.restrictedMode ? 'Nenhum conteúdo desta empresa foi atribuído a você.' : 'Essa empresa ainda não possui conteúdos programados.';
    var description = contentState.clientMode ? 'Quando um conteúdo for programado, ele aparecerá aqui automaticamente.' : contentState.restrictedMode ? 'Você verá aqui somente os conteúdos que estiverem sob sua responsabilidade.' : 'Cadastre o planejamento da semana ou do mês para começar.';
    return [
      '<div class="empty-state">',
        '<div class="empty-icon">' + ico.agenda + '</div>',
        '<h3>' + title + '</h3>',
        '<p>' + description + '</p>',
        contentState.permissions.canManage ? '<button class="btn btn-primary" onclick="openContentForm()">Criar primeiro conteúdo</button>' : '',
      '</div>'
    ].join('');
  }

  function renderContentCalendar() {
    var area = document.getElementById('content-calendar-area');
    if (!area) return;
    if (!contentState.posts.length) {
      area.innerHTML = emptyState();
      return;
    }
    if (contentState.view === 'week') area.innerHTML = renderWeek();
    else if (contentState.view === 'list' || window.innerWidth <= 760) area.innerHTML = renderList();
    else area.innerHTML = renderMonth();
  }

  function responsiveCalendarMode() {
    return window.innerWidth <= 760 ? 'compact' : 'wide';
  }

  function syncCalendarOnResize() {
    var nextMode = responsiveCalendarMode();
    if (nextMode === lastResponsiveMode) return;
    lastResponsiveMode = nextMode;
    if (document.getElementById('content-calendar-area')) renderContentCalendar();
  }

  window.addEventListener('resize', function () {
    window.clearTimeout(syncCalendarOnResize.timer);
    syncCalendarOnResize.timer = window.setTimeout(syncCalendarOnResize, 120);
  });

  function calendarTitle(title) {
    return [
      '<div class="calendar-titlebar">',
        '<div><h3>' + esc(title) + '</h3><div class="page-desc">' + esc(companyName()) + '</div></div>',
        '<div style="display:flex;gap:8px;align-items:center">',
          '<button class="btn btn-ghost" style="padding:8px 11px" onclick="goToday()">Hoje</button>',
          '<div class="month-nav"><button aria-label="Anterior" onclick="moveCalendar(-1)">‹</button>',
          '<button aria-label="Próximo" onclick="moveCalendar(1)">›</button></div>',
        '</div>',
      '</div>'
    ].join('');
  }

  function postPill(post) {
    var color = statusColors[post.status] || '#7c3aed';
    return '<button' + contentOpenAttributes(post.id, 'Abrir ' + post.title) + ' class="post-pill" title="' + esc(post.scheduledTime + ' · ' + post.title) +
      '" style="border-left-color:' + color + ';background:' + color + '14;color:' + color +
      '"><strong>' + esc(post.title) + '</strong><span>' +
      esc(post.scheduledTime + ' · ' + post.contentType + ' · ' + post.status) + '</span></button>';
  }

  function renderMonth() {
    var cursor = contentState.cursor;
    var year = cursor.getFullYear();
    var month = cursor.getMonth();
    var first = new Date(year, month, 1);
    var start = new Date(year, month, 1 - first.getDay());
    var today = dateKey(new Date());
    var cells = '';
    for (var index = 0; index < 42; index += 1) {
      var date = new Date(start);
      date.setDate(start.getDate() + index);
      var key = dateKey(date);
      var dayPosts = contentState.posts.filter(function (post) { return post.scheduledDate === key; });
      cells += [
        '<div class="posts-day ' + (date.getMonth() !== month ? 'out-month ' : '') + (key === today ? 'today' : '') + '">',
          '<div class="posts-day-num">' + date.getDate() + '</div>',
          dayPosts.slice(0, 3).map(postPill).join(''),
          dayPosts.length > 3 ? '<button class="post-pill" onclick="changeCalendarView(\'list\')">+' + (dayPosts.length - 3) + ' conteúdos</button>' : '',
        '</div>'
      ].join('');
    }
    var title = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return [
      '<div class="calendar-shell">',
        calendarTitle(title.charAt(0).toUpperCase() + title.slice(1)),
        '<div class="posts-cal-head"><div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div></div>',
        '<div class="posts-cal-grid">' + cells + '</div>',
      '</div>'
    ].join('');
  }

  function weekStart(date) {
    var start = new Date(date);
    var day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function renderWeek() {
    var start = weekStart(contentState.cursor);
    var end = new Date(start);
    end.setDate(start.getDate() + 6);
    var days = '';
    for (var index = 0; index < 7; index += 1) {
      var date = new Date(start);
      date.setDate(start.getDate() + index);
      var key = dateKey(date);
      var posts = contentState.posts.filter(function (post) { return post.scheduledDate === key; });
      days += [
        '<div class="week-day">',
          '<div class="week-day-head"><span>' + date.toLocaleDateString('pt-BR', { weekday: 'short' }) + '</span><b>' + date.getDate() + '</b></div>',
          posts.length ? posts.map(function (post) {
            return '<button' + contentOpenAttributes(post.id, 'Abrir ' + post.title) + ' class="week-post" style="width:100%;text-align:left;border-left-color:' + (statusColors[post.status] || '#7c3aed') +
              '"><div class="time">' +
              esc(post.scheduledTime + ' · ' + post.socialNetwork) + '</div><div class="title">' +
              esc(post.title) + '</div><div class="time" style="margin-top:5px;color:' +
              (statusColors[post.status] || '#7c3aed') + '">' + esc(post.status) + '</div></button>';
          }).join('') : '<div class="page-desc" style="text-align:center;padding:18px 0">Sem posts</div>',
        '</div>'
      ].join('');
    }
    var title = formatDate(dateKey(start), { day: '2-digit', month: 'short' }) + ' — ' +
      formatDate(dateKey(end), { day: '2-digit', month: 'short', year: 'numeric' });
    return '<div class="calendar-shell">' + calendarTitle(title) + '<div class="week-grid">' + days + '</div></div>';
  }

  function previewSmall(post) {
    var file = post.files && post.files[0];
    if (!file) return '<div class="post-preview-sm">' + ico.material + '</div>';
    if (String(file.fileType).indexOf('image/') === 0) {
      return '<div class="post-preview-sm"><img src="' + esc(file.previewUrl) + '" alt=""></div>';
    }
    if (String(file.fileType).indexOf('video/') === 0) {
      return '<div class="post-preview-sm"><video src="' + esc(file.previewUrl) + '" muted preload="metadata"></video></div>';
    }
    return '<div class="post-preview-sm">' + (file.fileType === 'application/pdf' ? 'PDF' : ico.material) + '</div>';
  }

  function renderList() {
    var sorted = contentState.posts.slice().sort(function (a, b) {
      return (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime);
    });
    var cards = sorted.map(function (post) {
      var color = statusColors[post.status] || '#7c3aed';
      return [
        '<button' + contentOpenAttributes(post.id, 'Abrir ' + post.title) + ' class="post-list-card" style="width:100%;text-align:left">',
          previewSmall(post),
          '<div><div class="post-list-title">' + esc(post.title) + '</div>',
            '<div class="post-list-meta"><span>' + esc(formatDate(post.scheduledDate)) + ' às ' + esc(post.scheduledTime) + '</span>',
            '<span>' + esc(post.contentType) + '</span><span>' + esc(post.socialNetwork) + '</span></div></div>',
          '<div class="post-list-actions"><span class="tag" style="background:' + color + '18;color:' + color + '"><span class="status-dot" style="background:' + color + '"></span>' + esc(post.status) + '</span></div>',
        '</button>'
      ].join('');
    }).join('');
    var listTitle = contentState.view === 'list' ? 'Próximos posts' : 'Conteúdos do calendário';
    return '<div class="calendar-shell"><div class="calendar-titlebar"><div><h3>' + listTitle + '</h3><div class="page-desc">' +
      esc(companyName()) + ' · ' + sorted.length + ' conteúdos</div></div></div><div class="posts-list" style="padding:16px">' + cards + '</div></div>';
  }

  function showModal(content, large) {
    closeContentModal();
    var root = document.createElement('div');
    root.id = 'content-modal-root';
    root.className = 'modal-backdrop';
    root.innerHTML = '<div class="modal ' + (large ? 'modal-lg' : '') + '" role="dialog" aria-modal="true">' + content + '</div>';
    root.addEventListener('click', function (event) {
      if (event.target === root) closeContentModal();
    });
    document.body.appendChild(root);
  }

  function closeContentModal() {
    var root = document.getElementById('content-modal-root');
    if (root) root.remove();
  }
  window.closeContentModal = closeContentModal;

  function modalHeader(title) {
    return '<div class="modal-head"><h2>' + esc(title) + '</h2><button class="modal-close" aria-label="Fechar" onclick="closeContentModal()">×</button></div>';
  }

  function formField(label, control, full, hint) {
    return '<div class="field ' + (full ? 'full' : '') + '"><label>' + esc(label) + '</label>' +
      control + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
  }

  function scheduleDateRow(value, description) {
    return '<div class="schedule-date-row">' +
      '<div><span class="schedule-date-label">Data</span><input type="date" name="scheduled_date" required value="' + esc(value || '') + '"></div>' +
      '<div class="schedule-description"><span class="schedule-date-label">Título/legenda desta data (opcional)</span><input name="schedule_description" maxlength="2000" value="' + esc(description || '') + '" placeholder="Esse texto será o título do card; se vazio, usaremos o título geral"></div>' +
      '<button type="button" class="btn-xs schedule-remove" onclick="removeContentScheduleDate(this)" aria-label="Remover esta data">Remover</button>' +
    '</div>';
  }

  function addContentScheduleDate() {
    var list = document.getElementById('content-schedule-dates');
    if (!list) return;
    if (list.querySelectorAll('.schedule-date-row').length >= 31) {
      showToast('Você pode adicionar no máximo 31 datas por vez.', true);
      return;
    }
    list.insertAdjacentHTML('beforeend', scheduleDateRow('', ''));
  }
  window.addContentScheduleDate = addContentScheduleDate;

  function removeContentScheduleDate(button) {
    var list = document.getElementById('content-schedule-dates');
    if (!list) return;
    var rows = list.querySelectorAll('.schedule-date-row');
    if (rows.length <= 1) {
      showToast('Mantenha pelo menos uma data programada.', true);
      return;
    }
    var row = button.closest('.schedule-date-row');
    if (row) row.remove();
  }
  window.removeContentScheduleDate = removeContentScheduleDate;

  function renderPendingContentFiles() {
    var list = document.getElementById('pending-content-files');
    if (!list) return;
    if (!contentState.pendingFiles.length) {
      list.innerHTML = '<div class="management-inline-empty">Nenhum arquivo selecionado.</div>';
      return;
    }
    list.innerHTML = contentState.pendingFiles.map(function (file, index) {
      return '<div class="file-row"><div class="file-main"><b>' + esc(file.name) + '</b><span>' + esc(formatBytes(file.size)) + '</span></div>' +
        '<button type="button" class="btn-xs" style="color:var(--vermelho)" onclick="removePendingContentFile(' + index + ')">Remover</button></div>';
    }).join('') + '<button type="button" class="btn btn-ghost clear-files-button" onclick="clearPendingContentFiles()">Limpar todos os arquivos</button>';
  }

  function handleContentFiles(input) {
    contentState.pendingFiles = Array.prototype.slice.call(input.files || []);
    renderPendingContentFiles();
  }
  window.handleContentFiles = handleContentFiles;

  function removePendingContentFile(index) {
    contentState.pendingFiles.splice(index, 1);
    renderPendingContentFiles();
  }
  window.removePendingContentFile = removePendingContentFile;

  function clearPendingContentFiles() {
    contentState.pendingFiles = [];
    var input = document.getElementById('content-files-input');
    if (input) input.value = '';
    renderPendingContentFiles();
  }
  window.clearPendingContentFiles = clearPendingContentFiles;

  async function cleanupDirectContentUploads(prepared, postId) {
    if (!prepared || !prepared.uploads || !prepared.uploads.length) return;
    try {
      await apiJson('/api/post-upload-signatures', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: prepared.companyId || contentState.tenantId,
          postId: postId || '',
          paths: prepared.uploads.map(function (upload) { return upload.path; })
        })
      });
    } catch (ignored) {}
  }

  function contentFileMimeType(file) {
    if (file.type) return file.type;
    var extension = String(file.name || '').split('.').pop().toLowerCase();
    var known = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml',
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
      pdf: 'application/pdf'
    };
    return known[extension] || 'application/octet-stream';
  }

  async function uploadContentFilesDirect(files, postId, button) {
    var descriptors = files.map(function (file) {
      return { name: file.name, type: contentFileMimeType(file), size: file.size };
    });
    var prepared = await apiJson('/api/post-upload-signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: contentState.tenantId, postId: postId || '', files: descriptors })
    });
    try {
      for (var index = 0; index < files.length; index += 1) {
        if (button) button.textContent = 'Enviando arquivo ' + (index + 1) + ' de ' + files.length + '...';
        var upload = prepared.uploads[index];
        if (!upload || !upload.signedUrl) throw new Error('Não foi possível preparar o envio de todos os arquivos.');
        var uploadBody = new FormData();
        uploadBody.append('cacheControl', '3600');
        uploadBody.append('', files[index], files[index].name);
        var response = await fetch(upload.signedUrl, {
          method: 'PUT',
          headers: { 'x-upsert': 'false' },
          body: uploadBody
        });
        if (!response.ok) {
          throw new Error('Não foi possível enviar o arquivo ' + (index + 1) + '. Verifique sua conexão e tente novamente.');
        }
      }
      return prepared;
    } catch (error) {
      await cleanupDirectContentUploads(prepared, postId);
      throw error;
    }
  }

  function uploadedFileMetadata(prepared) {
    return (prepared && prepared.uploads || []).map(function (upload) {
      return {
        path: upload.path,
        fileName: upload.fileName,
        fileType: upload.fileType,
        fileSize: upload.fileSize,
        mimeType: upload.mimeType,
        orderIndex: upload.orderIndex
      };
    });
  }

  function agencyContentFileRows(post) {
    return (post.files || []).map(function (file) {
      return '<div class="file-row"><div class="file-main"><b>' + esc(file.fileName) + '</b><span>' + esc(formatBytes(file.fileSize)) + '</span></div><div class="management-actions">' +
        '<a class="btn-xs" href="' + esc(file.previewUrl) + '" target="_blank" rel="noopener">Abrir</a>' +
        '<button type="button" class="btn-xs" style="color:var(--vermelho)" onclick="deleteContentFile(\'' + esc(file.id) + '\',\'' + esc(post.id) + '\',true)">Excluir arquivo</button>' +
      '</div></div>';
    }).join('');
  }

  function openContentForm(postId) {
    if (!contentState.permissions.canManage) {
      showToast('Somente a agência pode criar ou editar conteúdos.', true);
      return;
    }
    var post = postId ? contentState.posts.find(function (item) { return item.id === postId; }) : null;
    var editing = Boolean(post);
    contentState.pendingFiles = [];
    var today = dateKey(new Date());
    var teamOptions = contentState.team.map(function (person) { return { value: person.id, label: person.name || person.email }; });
    var partnerOptions = contentState.partners.map(function (partner) {
      return { value: partner.id, label: partner.name + (partner.specialty ? ' · ' + partner.specialty : '') };
    });
    var planningFields = [
      formField('Título do conteúdo', '<input name="title" required maxlength="120" value="' + esc(post ? post.title : '') + '" placeholder="Ex.: Carrossel de lançamento">', true),
      formField('Tipo de conteúdo', '<select name="content_type" required>' + options(contentTypes, post ? post.contentType : 'Post') + '</select>'),
      formField('Rede social sugerida', '<select name="social_network" required>' + options(networks, post ? post.socialNetwork : 'Instagram') + '</select>'),
      editing
        ? formField('Data programada', '<input type="date" name="scheduled_date" required value="' + esc(post.scheduledDate) + '">')
        : formField('Datas programadas', '<div id="content-schedule-dates" class="schedule-date-list">' + scheduleDateRow(today, '') + '</div><button type="button" class="btn btn-ghost add-date-button" onclick="addContentScheduleDate()">+ Adicionar outra data</button>', true, 'Cadastre até 31 datas de uma só vez. Cada data criará um conteúdo separado no calendário.'),
      formField('Horário programado', '<input type="time" name="scheduled_time" required value="' + esc(post ? post.scheduledTime : '09:00') + '">')
    ];
    var copyFields = [
      formField('Legenda / texto', '<textarea name="caption" placeholder="Escreva a legenda completa...">' + esc(post ? post.caption : '') + '</textarea>', true),
      formField('Orientações para o cliente', '<textarea name="client_notes" placeholder="Ex.: publique no feed, marque o parceiro e use a música indicada...">' + esc(post ? post.clientNotes : '') + '</textarea>', true, 'Estas observações ficam visíveis para o cliente.'),
      formField('Observações internas', '<textarea name="internal_notes" placeholder="Informações visíveis apenas para a agência...">' + esc(post ? post.internalNotes : '') + '</textarea>', true)
    ];
    var workflowFields = [
      formField('Situação inicial', '<select name="status" required>' + options(statuses, post ? post.status : 'Rascunho') + '</select>'),
      formField('Responsável interno', '<select name="assigned_to">' + (function () { var html = '<option value="">Não definido</option>'; return html + teamOptions.map(function (person) { return '<option value="' + esc(person.value) + '"' + (post && post.assignedTo === person.value ? ' selected' : '') + '>' + esc(person.label) + '</option>'; }).join(''); })() + '</select>'),
      formField('Parceiro responsável', '<select name="partner_id">' + (function () { var html = '<option value="">Sem parceiro atribuído</option>'; return html + partnerOptions.map(function (partner) { return '<option value="' + esc(partner.value) + '"' + (post && post.partnerId === partner.value ? ' selected' : '') + '>' + esc(partner.label) + '</option>'; }).join(''); })() + '</select>', false, 'Todos os parceiros ativos cadastrados aparecem aqui. Quando o login estiver vinculado, o parceiro poderá editar a legenda, atualizar a situação e anexar materiais. Esta atribuição não fica visível para o cliente.')
    ];
    if (!editing) {
      workflowFields.push(formField(
        'Arquivos do conteúdo (opcional)',
        '<div class="upload-zone"><div style="font-weight:700;margin-bottom:5px">Imagem, arte, vídeo ou PDF</div><input id="content-files-input" type="file" accept="image/*,video/*,application/pdf" multiple onchange="handleContentFiles(this)"></div><div id="pending-content-files" class="file-list pending-file-list"><div class="management-inline-empty">Nenhum arquivo selecionado.</div></div>',
        true,
        'Você pode salvar sem anexos e adicionar os materiais depois. Para carrossel, selecione as imagens na ordem correta.'
      ));
    } else {
      workflowFields.push(formField('Arquivos atuais', '<div class="file-list">' + (agencyContentFileRows(post) || '<div class="management-inline-empty">Nenhum arquivo anexado.</div>') + '</div>', true));
      workflowFields.push(formField('Adicionar novos arquivos', '<div class="upload-zone"><input id="content-files-input" type="file" accept="image/*,video/*,application/pdf" multiple onchange="handleContentFiles(this)"></div><div id="pending-content-files" class="file-list pending-file-list"><div class="management-inline-empty">Nenhum arquivo selecionado.</div></div>', true, 'Os novos arquivos serão adicionados sem substituir os atuais.'));
    }
    var html = modalHeader(editing ? 'Editar conteúdo' : 'Novo conteúdo') +
      '<form id="content-form" class="modal-body" onsubmit="saveContent(event,\'' + (post ? esc(post.id) : '') + '\')">' +
      '<section class="form-section"><div class="form-section-title">1. Planejamento</div><div class="form-section-desc">Defina o formato, a rede e quando o conteúdo deve ser publicado.</div><div class="form-grid">' + planningFields.join('') + '</div></section>' +
      '<section class="form-section"><div class="form-section-title">2. Texto e orientações</div><div class="form-section-desc">Organize a legenda e as instruções que acompanharão a entrega.</div><div class="form-grid">' + copyFields.join('') + '</div></section>' +
      '<section class="form-section"><div class="form-section-title">3. Arquivos e fluxo</div><div class="form-section-desc">Adicione o material agora ou depois e escolha quem ficará responsável.</div><div class="form-grid">' + workflowFields.join('') + '</div></section>' +
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeContentModal()">Cancelar</button>' +
      '<button id="save-content-button" type="submit" class="btn btn-primary">' + (editing ? 'Salvar alterações' : 'Salvar conteúdo') + '</button></div></form>';
    showModal(html, false);
  }
  window.openContentForm = openContentForm;

  async function saveContent(event, postId) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = document.getElementById('save-content-button');
    var createdCount = 0;
    var preparedUploads = null;
    button.disabled = true;
    button.textContent = 'Salvando...';
    try {
      if (postId) {
        var formData = new FormData(form);
        var payload = {
          tenantId: contentState.tenantId,
          title: formData.get('title'),
          contentType: formData.get('content_type'),
          socialNetwork: formData.get('social_network'),
          scheduledDate: formData.get('scheduled_date'),
          scheduledTime: formData.get('scheduled_time'),
          caption: formData.get('caption'),
          clientNotes: formData.get('client_notes'),
          internalNotes: formData.get('internal_notes'),
          status: formData.get('status'),
          assignedTo: formData.get('assigned_to'),
          partnerId: formData.get('partner_id')
        };
        await apiJson('/api/posts/' + encodeURIComponent(postId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        var createData = new FormData(form);
        if (contentState.pendingFiles.length) {
          preparedUploads = await uploadContentFilesDirect(contentState.pendingFiles, '', button);
        }
        button.textContent = 'Criando conteúdo...';
        var dates = createData.getAll('scheduled_date');
        var descriptions = createData.getAll('schedule_description');
        var created = await apiJson('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: contentState.tenantId,
            title: createData.get('title'),
            contentType: createData.get('content_type'),
            socialNetwork: createData.get('social_network'),
            scheduledTime: createData.get('scheduled_time'),
            caption: createData.get('caption'),
            clientNotes: createData.get('client_notes'),
            internalNotes: createData.get('internal_notes'),
            status: createData.get('status'),
            assignedTo: createData.get('assigned_to'),
            partnerId: createData.get('partner_id'),
            schedules: dates.map(function (date, index) {
              return { date: date, description: descriptions[index] || '' };
            }),
            uploadedFiles: uploadedFileMetadata(preparedUploads)
          })
        });
        createdCount = Number(created.createdCount || 1);
        preparedUploads = null;
      }
      if (postId && contentState.pendingFiles.length) {
        preparedUploads = await uploadContentFilesDirect(contentState.pendingFiles, postId, button);
        button.textContent = 'Vinculando arquivos...';
        await apiJson('/api/post-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: postId, uploadedFiles: uploadedFileMetadata(preparedUploads) })
        });
        preparedUploads = null;
      }
      closeContentModal();
      if (postId) showToast('Conteúdo atualizado com sucesso.');
      else showToast(createdCount > 1 ? createdCount + ' conteúdos foram criados no calendário.' : 'Conteúdo salvo no calendário.');
      await loadContentPosts();
    } catch (error) {
      await cleanupDirectContentUploads(preparedUploads, postId);
      showToast(error.message, true);
      button.disabled = false;
      button.textContent = postId ? 'Salvar alterações' : 'Salvar conteúdo';
    }
  }
  window.saveContent = saveContent;

  function assignedContentFileRows(post) {
    var actor = currentActor();
    return (post.files || []).map(function (file) {
      var canDelete = file.uploadedBy && file.uploadedBy === actor.id;
      return '<div class="file-row"><div class="file-main"><b>' + esc(file.fileName) + '</b><span>' + esc(formatBytes(file.fileSize)) + '</span></div><div class="management-actions"><a class="btn-xs" href="' + esc(file.previewUrl) + '" target="_blank" rel="noopener">Abrir</a><a class="btn-xs" href="' + esc(file.downloadUrl) + '" download>Baixar</a>' + (canDelete ? '<button type="button" class="btn-xs" style="color:var(--vermelho)" onclick="deleteAssignedPostFile(\'' + esc(file.id) + '\',\'' + esc(post.id) + '\')">Excluir meu envio</button>' : '') + '</div></div>';
    }).join('');
  }

  function openAssignedContentForm(id) {
    if (!contentState.permissions.canEditAssigned) {
      showToast('Você só pode atualizar conteúdos atribuídos ao seu perfil.', true);
      return;
    }
    var post = contentState.posts.find(function (item) { return item.id === id; });
    if (!post) return;
    var files = assignedContentFileRows(post);
    var html = modalHeader('Atualizar conteúdo atribuído') +
      '<form id="assigned-content-form" onsubmit="saveAssignedContent(event,\'' + esc(post.id) + '\')"><div class="modal-body">' +
      '<div class="detail-summary"><span class="tag tag-roxo">' + esc(post.contentType) + '</span><h3>' + esc(post.title) + '</h3><p>' + esc(companyName()) + ' · ' + esc(formatDate(post.scheduledDate)) + ' às ' + esc(post.scheduledTime) + '</p></div>' +
      '<section class="form-section"><div class="form-section-title">Descrição e andamento</div><div class="form-section-desc">Você pode atualizar a descrição/legenda e a situação deste conteúdo.</div><div class="form-grid">' +
      formField('Situação', '<select name="status" required>' + options(statuses, post.status) + '</select>') +
      formField('Descrição / legenda', '<textarea name="caption" placeholder="Atualize as informações do conteúdo...">' + esc(post.caption || '') + '</textarea>', true) +
      '</div></section>' +
      '<section class="form-section"><div class="form-section-title">Materiais anexados</div><div class="form-section-desc">Fotografias, calendários, documentos e demais arquivos ficam vinculados a este conteúdo.</div><div class="file-list">' + (files || '<div class="management-inline-empty">Nenhum material anexado ainda.</div>') + '</div></section>' +
      '<label class="upload-zone upload-zone-active"><span class="upload-icon">' + ico.upload + '</span><b>Anexar novos materiais</b><span>Selecione os arquivos na ordem desejada. Os originais serão preservados sem compressão.</span><input name="files" type="file" multiple></label>' +
      '</div><div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeContentModal()">Cancelar</button><button id="save-assigned-content-button" class="btn btn-primary" type="submit">Salvar atualização</button></div></form>';
    showModal(html, true);
  }
  window.openAssignedContentForm = openAssignedContentForm;

  async function saveAssignedContent(event, id) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = document.getElementById('save-assigned-content-button');
    if (button) { button.disabled = true; button.textContent = 'Salvando...'; }
    var preparedUploads = null;
    try {
      var data = new FormData(form);
      await apiJson('/api/posts/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: data.get('caption'), status: data.get('status') })
      });
      var files = data.getAll('files').filter(function (file) { return file && file.size > 0; });
      if (files.length) {
        preparedUploads = await uploadContentFilesDirect(files, id, button);
        if (button) button.textContent = 'Vinculando arquivos...';
        await apiJson('/api/post-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: id, uploadedFiles: uploadedFileMetadata(preparedUploads) })
        });
        preparedUploads = null;
      }
      closeContentModal();
      showToast(files.length ? 'Conteúdo atualizado e materiais anexados.' : 'Conteúdo atualizado com sucesso.');
      await loadContentPosts();
    } catch (error) {
      await cleanupDirectContentUploads(preparedUploads, id);
      showToast(error.message, true);
      if (button) { button.disabled = false; button.textContent = 'Salvar atualização'; }
    }
  }
  window.saveAssignedContent = saveAssignedContent;

  async function deleteAssignedPostFile(fileId, postId) {
    if (!window.confirm('Excluir este arquivo enviado por você?')) return;
    try {
      await apiJson('/api/post-files?id=' + encodeURIComponent(fileId), { method: 'DELETE' });
      closeContentModal();
      showToast('Arquivo excluído.');
      await loadContentPosts();
      openAssignedContentForm(postId);
    } catch (error) { showToast(error.message, true); }
  }
  window.deleteAssignedPostFile = deleteAssignedPostFile;

  async function deleteContentFile(fileId, postId, reopenEdit) {
    if (!window.confirm('Excluir este arquivo definitivamente?')) return;
    try {
      await apiJson('/api/post-files?id=' + encodeURIComponent(fileId), { method: 'DELETE' });
      closeContentModal();
      showToast('Arquivo excluído do conteúdo.');
      await loadContentPosts();
      if (contentState.posts.some(function (post) { return post.id === postId; })) {
        if (reopenEdit) openContentForm(postId);
        else openContentDetails(postId);
      }
    } catch (error) { showToast(error.message, true); }
  }
  window.deleteContentFile = deleteContentFile;

  function mainPreview(post) {
    var file = post.files && post.files[0];
    if (!file) return '<div style="color:#fff;text-align:center">' + ico.material + '<div style="margin-top:8px">Sem arquivo</div></div>';
    if (String(file.fileType).indexOf('image/') === 0) {
      return '<img src="' + esc(file.previewUrl) + '" alt="' + esc(post.title) + '">';
    }
    if (String(file.fileType).indexOf('video/') === 0) {
      return '<video src="' + esc(file.previewUrl) + '" controls preload="metadata"></video>';
    }
    if (file.fileType === 'application/pdf') {
      return '<iframe src="' + esc(file.previewUrl) + '" title="' + esc(file.fileName) + '"></iframe>';
    }
    return '<div style="color:#fff">Arquivo disponível para download</div>';
  }

  function openContentDetails(id) {
    var post = contentState.posts.find(function (item) { return item.id === id; });
    if (!post) return;
    var color = statusColors[post.status] || '#7c3aed';
    var files = (post.files || []).map(function (file, index) {
      return '<div class="file-row"><div class="file-main"><a class="file-link" href="' + esc(file.downloadUrl) + '" download>↓ Original ' +
        esc((index + 1) + '. ' + file.fileName) + ' · ' + esc(formatBytes(file.fileSize)) + '</a></div>' +
        (contentState.permissions.canManage ? '<button type="button" class="btn-xs" style="color:var(--vermelho)" onclick="deleteContentFile(\'' + esc(file.id) + '\',\'' + esc(post.id) + '\',false)">Excluir</button>' : '') + '</div>';
    }).join('');
    var review = '';
    if (!contentState.permissions.canManage && contentState.permissions.canReview) {
      var reviewActions = [
        post.status !== 'Aprovado' && post.status !== 'Publicado' ? '<button class="btn btn-primary" onclick="reviewContent(\'' + esc(post.id) + '\',\'Aprovado\')">✓ Aprovar</button>' : '',
        post.status !== 'Publicado' ? '<button class="btn btn-ghost" onclick="reviewContent(\'' + esc(post.id) + '\',\'Revisão solicitada\')">Solicitar alteração</button>' : '',
        '<button class="btn btn-ghost" onclick="saveClientComment(\'' + esc(post.id) + '\')">Enviar comentário</button>'
      ].join('');
      review = [
        '<div class="client-review">',
          '<div style="font-weight:700;margin-bottom:4px">Aprovação e comentários</div>',
          '<div class="page-desc" style="margin-bottom:8px">A agência receberá sua aprovação ou solicitação de alteração.</div>',
          '<textarea id="client-feedback" style="width:100%;min-height:82px;border:1px solid var(--cinza-borda);border-radius:9px;padding:10px" placeholder="Escreva um comentário para a agência...">' + esc(post.clientFeedback || '') + '</textarea>',
          '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">',
            reviewActions,
          '</div>',
        '</div>'
      ].join('');
    }
    var management = contentState.permissions.canManage ? [
      '<button class="btn btn-ghost" onclick="openContentForm(\'' + esc(post.id) + '\')">Editar</button>',
      '<button class="btn btn-ghost" style="color:var(--vermelho)" onclick="deleteContent(\'' + esc(post.id) + '\')">Excluir</button>'
    ].join('') : contentState.permissions.canEditAssigned ? '<button class="btn btn-primary" onclick="openAssignedContentForm(\'' + esc(post.id) + '\')">Atualizar e anexar materiais</button>' : '';
    var responsibilityDetails = '';
    if (contentState.permissions.canManage) {
      var internalResponsible = contentState.team.find(function (person) { return person.id === post.assignedTo; });
      var partnerResponsible = contentState.partners.find(function (partner) { return partner.id === post.partnerId; });
      responsibilityDetails = '<div class="detail-row"><div class="detail-label">Responsável interno</div><div class="detail-value">' + esc(internalResponsible ? internalResponsible.name : 'Não definido') + '</div></div>' +
        '<div class="detail-row"><div class="detail-label">Parceiro responsável</div><div class="detail-value">' + esc(partnerResponsible ? partnerResponsible.name : 'Não definido') + '</div></div>';
    } else if (contentState.permissions.canEditAssigned) {
      responsibilityDetails = '<div class="detail-row"><div class="detail-label">Atribuição</div><div class="detail-value">Atribuído a você</div></div>';
    }
    var commentHistory = (post.comments || []).length ? '<div class="detail-row"><div class="detail-label">Histórico de comentários</div>' + post.comments.map(function (comment) { return '<div style="padding:10px 0;border-bottom:1px solid var(--cinza-borda)"><div style="font-size:12px;font-weight:700">' + esc(comment.author) + '</div><div class="detail-value">' + esc(comment.comment) + '</div></div>'; }).join('') + '</div>' : '';
    var html = modalHeader(post.title) +
      '<div class="modal-body"><div class="detail-grid">' +
      '<div><div class="file-gallery">' + mainPreview(post) + '</div><div class="file-links">' + files + '</div></div>' +
      '<div class="detail-info">' +
        '<div><span class="tag" style="background:' + color + '18;color:' + color + '"><span class="status-dot" style="background:' + color + '"></span>' + esc(post.status) + '</span></div>' +
        '<div class="detail-row"><div class="detail-label">Programação</div><div class="detail-value">' + esc(formatDate(post.scheduledDate)) + ' às ' + esc(post.scheduledTime) + '</div></div>' +
        '<div class="detail-row"><div class="detail-label">Formato e rede</div><div class="detail-value">' + esc(post.contentType) + ' · ' + esc(post.socialNetwork) + '</div></div>' +
        '<div class="detail-row"><div class="detail-label">Legenda / texto</div><div class="detail-value">' + esc(post.caption || 'Sem legenda cadastrada.') + '</div><button class="btn btn-ghost" style="margin-top:9px;padding:7px 10px" onclick="copyCaption(\'' + esc(post.id) + '\')">Copiar legenda</button></div>' +
        (post.clientNotes ? '<div class="detail-row"><div class="detail-label">Orientações para publicação</div><div class="detail-value">' + esc(post.clientNotes) + '</div></div>' : '') +
        (contentState.permissions.canManage ? '<div class="detail-row"><div class="detail-label">Observações internas</div><div class="detail-value">' + esc(post.internalNotes || 'Sem observações.') + '</div></div>' : '') +
        (contentState.permissions.canManage && post.clientFeedback ? '<div class="detail-row"><div class="detail-label">Comentário do cliente</div><div class="detail-value">' + esc(post.clientFeedback) + '</div></div>' : '') +
        commentHistory +
        responsibilityDetails +
        (contentState.clientMode ? '<div class="client-review" style="background:#f8fafc;border-color:#e2e8f0"><b style="font-size:12px">Publicação manual e segura</b><div class="page-desc">Nenhuma senha de rede social é solicitada. Use os arquivos e a legenda acima para publicar na sua própria conta.</div></div>' : '') +
        (contentState.permissions.canEditAssigned ? '<div class="client-review" style="background:#f8fafc;border-color:#e2e8f0"><b style="font-size:12px">Conteúdo sob sua responsabilidade</b><div class="page-desc">Você pode atualizar a descrição, mudar a situação e anexar os materiais para conferência dos sócios.</div></div>' : '') +
        review +
      '</div></div><div class="modal-actions">' + management + '<button class="btn btn-primary" onclick="closeContentModal()">Fechar</button></div></div>';
    showModal(html, true);
  }
  window.openContentDetails = openContentDetails;

  async function copyCaption(id) {
    var post = contentState.posts.find(function (item) { return item.id === id; });
    if (!post) return;
    try {
      await navigator.clipboard.writeText(post.caption || '');
      showToast('Legenda copiada.');
    } catch (error) {
      showToast('Não foi possível copiar a legenda.', true);
    }
  }
  window.copyCaption = copyCaption;

  async function reviewContent(id, status) {
    var field = document.getElementById('client-feedback');
    var feedback = field ? field.value.trim() : '';
    if (status === 'Revisão solicitada' && !feedback) {
      showToast('Explique qual alteração precisa ser feita.', true);
      return;
    }
    try {
      await apiJson('/api/posts/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: contentState.tenantId,
          status: status,
          clientFeedback: feedback
        })
      });
      closeContentModal();
      showToast(status === 'Aprovado' ? 'Conteúdo aprovado.' : 'Alteração solicitada.');
      await loadContentPosts();
    } catch (error) {
      showToast(error.message, true);
    }
  }
  window.reviewContent = reviewContent;

  async function saveClientComment(id) {
    var field = document.getElementById('client-feedback');
    var feedback = field ? field.value.trim() : '';
    if (!feedback) {
      showToast('Escreva um comentário antes de enviar.', true);
      return;
    }
    try {
      await apiJson('/api/posts/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: contentState.tenantId,
          clientFeedback: feedback
        })
      });
      closeContentModal();
      showToast('Comentário enviado para a agência.');
      await loadContentPosts();
    } catch (error) {
      showToast(error.message, true);
    }
  }
  window.saveClientComment = saveClientComment;

  async function deleteContent(id) {
    if (!window.confirm('Excluir este conteúdo e todos os arquivos vinculados?')) return;
    try {
      await apiJson('/api/posts/' + encodeURIComponent(id) + '?tenant_id=' + encodeURIComponent(contentState.tenantId), {
        method: 'DELETE'
      });
      closeContentModal();
      showToast('Conteúdo excluído.');
      await loadContentPosts();
    } catch (error) {
      showToast(error.message, true);
    }
  }
  window.deleteContent = deleteContent;

  function showToast(message, error) {
    var previous = document.querySelector('.toast');
    if (previous) previous.remove();
    var toast = document.createElement('div');
    toast.className = 'toast' + (error ? ' erro' : '');
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () { if (toast.parentNode) toast.remove(); }, 3400);
  }

  window.addEventListener('resize', function () {
    if (document.getElementById('content-calendar-area')) renderContentCalendar();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeContentModal();
  });
})();
