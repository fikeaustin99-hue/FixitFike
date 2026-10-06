/* Fike Fix — customer reviews: storage layer + UI */
(function () {
  'use strict';

  var CFG = Object.assign({
    ownerEmail: '',
    publishedFile: 'reviews.json',
    supabaseUrl: '',
    supabaseAnonKey: '',
    pageSize: 6,
    photoBucket: 'review-photos',
    maxPhotos: 4
  }, window.FIKE_REVIEWS_CONFIG || {});

  var PENDING_KEY = 'fikefix.pendingReviews.v1';
  var LAST_SUBMIT_KEY = 'fikefix.lastReviewAt';
  var SERVICES = ['TV mounting', 'Trimwork', 'Furniture assembly', 'Painting', 'Door & lock repair', 'Computer repairs', 'Something else'];

  /* ======================================================================
   * STORAGE
   * ====================================================================== */
  var hasSupabase = !!(CFG.supabaseUrl && CFG.supabaseAnonKey &&
    /^https:\/\/.+\.supabase\.co\/?$/.test(CFG.supabaseUrl.trim()));
  var SB = hasSupabase ? CFG.supabaseUrl.trim().replace(/\/$/, '') : '';

  function sbHeaders(extra) {
    var h = { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' };
    // Legacy JWT anon keys also go in Authorization; new sb_publishable_ keys only use apikey.
    if (/^eyJ/.test(CFG.supabaseAnonKey)) h.Authorization = 'Bearer ' + CFG.supabaseAnonKey;
    return Object.assign(h, extra || {});
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  // Normalize + validate any review record coming from storage.
  function clean(r) {
    if (!r || typeof r !== 'object') return null;
    var rating = parseInt(r.rating, 10);
    var name = String(r.name || '').trim().slice(0, 60);
    var comment = String(r.comment || '').trim().slice(0, 600);
    if (!(rating >= 1 && rating <= 5) || !name || !comment) return null;
    var date = new Date(r.created_at || r.date || Date.now());
    if (isNaN(date)) date = new Date();
    return {
      id: String(r.id || uid()),
      name: name,
      town: String(r.town || '').trim().slice(0, 40),
      service: String(r.service || '').trim().slice(0, 40),
      rating: rating,
      comment: comment,
      reply: String(r.reply || '').trim().slice(0, 600),
      created_at: date.toISOString(),
      pending: !!r.pending,
      // Storage paths ("<review id>/1.jpg") from the database
      photos: (Array.isArray(r.photos) ? r.photos : []).filter(function (x) {
        return typeof x === 'string' && /^[0-9a-f-]{36}\/[1-4]\.jpg$/.test(x);
      }).slice(0, 4),
      // Small preview images kept on the customer's device for their pending review
      thumbs: (Array.isArray(r.thumbs) ? r.thumbs : []).filter(function (x) {
        return typeof x === 'string' && /^data:image\/jpeg;base64,/.test(x);
      }).slice(0, 4),
      photoUrls: []
    };
  }

  var local = {
    read: function () {
      try { return (JSON.parse(localStorage.getItem(PENDING_KEY)) || []).map(clean).filter(Boolean); }
      catch (e) { return []; }
    },
    write: function (list) {
      try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
    },
    add: function (r) {
      var l = local.read(); l.unshift(r); l = l.slice(0, 10);
      local.write(l);
      // If storage is full, keep the review text and drop the device previews.
      try { if (localStorage.getItem(PENDING_KEY) !== JSON.stringify(l)) throw 0; }
      catch (e) { local.write(l.map(function (x) { return Object.assign({}, x, { thumbs: [] }); })); }
    },
    // Drop pending items once they show up in the published list.
    prune: function (published) {
      var ids = {}; published.forEach(function (p) { ids[p.id] = 1; });
      var l = local.read().filter(function (p) { return !ids[p.id]; });
      local.write(l); return l;
    }
  };

  async function loadFile() {
    var res = await fetch(CFG.publishedFile + '?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('reviews.json ' + res.status);
    var data = await res.json();
    if (!Array.isArray(data)) data = data.reviews || [];
    return data;
  }

  async function loadSupabase() {
    var q = '/rest/v1/reviews?select=id,name,town,service,rating,comment,reply,photos,created_at&approved=eq.true&order=created_at.desc&limit=500';
    var res = await fetch(SB + q, { headers: sbHeaders() });
    if (!res.ok) throw new Error('Supabase ' + res.status);
    return res.json();
  }

  // Photos live in a private bucket; the database only lets visitors open
  // photos that belong to approved reviews, via short-lived signed links.
  async function signPhotos(reviews) {
    var paths = [];
    reviews.forEach(function (r) { paths = paths.concat(r.photos); });
    if (!paths.length) return;
    try {
      var res = await fetch(SB + '/storage/v1/object/sign/' + CFG.photoBucket, {
        method: 'POST', headers: sbHeaders(),
        body: JSON.stringify({ expiresIn: 60 * 60 * 24, paths: paths })
      });
      if (!res.ok) throw new Error('sign ' + res.status);
      var map = {};
      (await res.json()).forEach(function (x) { if (x.signedURL) map[x.path] = SB + '/storage/v1' + x.signedURL; });
      reviews.forEach(function (r) {
        r.photoUrls = r.photos.map(function (p) { return map[p]; }).filter(Boolean);
      });
    } catch (e) { console.warn('[reviews] photos unavailable', e); }
  }

  async function uploadPhoto(path, blob) {
    var res = await fetch(SB + '/storage/v1/object/' + CFG.photoBucket + '/' + path, {
      method: 'POST',
      headers: Object.assign(sbHeaders(), { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }),
      body: blob
    });
    if (!res.ok) throw new Error('Could not upload your photos (' + res.status + '). Try again, or send the review without photos.');
  }

  var Store = {
    source: 'file',
    async list() {
      var rows = [];
      if (hasSupabase) {
        try { rows = await loadSupabase(); Store.source = 'database'; }
        catch (e) {
          console.warn('[reviews] database unavailable, using reviews.json', e);
          Store.source = 'file-fallback';
          try { rows = await loadFile(); } catch (e2) { rows = []; }
        }
      } else {
        try { rows = await loadFile(); } catch (e) { console.warn('[reviews]', e); rows = []; }
        Store.source = 'file';
      }
      var published = rows.map(clean).filter(Boolean).map(function (r) { r.pending = false; r.thumbs = []; return r; });
      if (Store.source === 'database') await signPhotos(published);
      var pending = local.prune(published).map(function (r) { r.pending = true; return r; });
      return { published: published, pending: pending };
    },

    async submit(review) {
      // 1) Live database
      if (hasSupabase && Store.source === 'database') {
        var paths = [];
        for (var i = 0; i < (review.files || []).length; i++) {
          var path = review.id + '/' + (i + 1) + '.jpg';
          await uploadPhoto(path, review.files[i].blob);
          paths.push(path);
        }
        var res = await fetch(SB + '/rest/v1/reviews', {
          method: 'POST',
          headers: sbHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({
            id: review.id, name: review.name, town: review.town || null, service: review.service || null,
            rating: review.rating, comment: review.comment, photos: paths, approved: false
          })
        });
        if (!res.ok) throw new Error('Could not save your review (' + res.status + ').');
        local.add(Object.assign({}, review, { files: undefined, photos: paths, pending: true }));
        return { via: 'database' };
      }

      // 2) Email to the owner (works on any static host, no account needed)
      var publishJson = JSON.stringify({
        id: review.id, name: review.name, town: review.town, service: review.service,
        rating: review.rating, comment: review.comment, reply: '', created_at: review.created_at
      }, null, 2);
      var payload = {
        _subject: 'New ' + review.rating + '-star review from ' + review.name + ' (Fike Fix website)',
        _template: 'table',
        _captcha: 'false',
        _honey: '',
        Rating: '★'.repeat(review.rating) + ' (' + review.rating + '/5)',
        Name: review.name,
        Town: review.town || '—',
        Service: review.service || '—',
        Review: review.comment,
        'To publish: paste into reviews.json': publishJson
      };
      var ok = false;
      if (CFG.ownerEmail) {
        try {
          var r2 = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(CFG.ownerEmail), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
          });
          ok = r2.ok;
        } catch (e) { ok = false; }
      }
      local.add(Object.assign({}, review, { pending: true }));
      if (!ok) {
        var body = 'Rating: ' + review.rating + '/5\nName: ' + review.name + '\nTown: ' + (review.town || '-') +
          '\nService: ' + (review.service || '-') + '\n\n' + review.comment + '\n\n---\nreviews.json entry:\n' + publishJson;
        return {
          via: 'mailto',
          mailto: 'mailto:' + CFG.ownerEmail + '?subject=' + encodeURIComponent(payload._subject) + '&body=' + encodeURIComponent(body)
        };
      }
      return { via: 'email' };
    }
  };

  window.FikeReviewStore = Store; // handy for debugging in the console

  /* ======================================================================
   * UI
   * ====================================================================== */
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var STAR_PATH = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z';
  var gradN = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function starsSVG(value, small) {
    var wrap = el('span', 'stars' + (small ? ' sm' : ''));
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', (Math.round(value * 10) / 10) + ' out of 5 stars');
    for (var i = 1; i <= 5; i++) {
      var pct = Math.max(0, Math.min(1, value - (i - 1))) * 100;
      var id = 'sg' + (++gradN);
      wrap.insertAdjacentHTML('beforeend',
        '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="' + id + '">' +
        '<stop offset="' + pct + '%" stop-color="currentColor"/><stop offset="' + pct + '%" stop-color="var(--track)"/>' +
        '</linearGradient></defs><path d="' + STAR_PATH + '" fill="url(#' + id + ')" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>');
    }
    return wrap;
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  var state = { published: [], pending: [], filter: 'all', sort: 'new', shown: CFG.pageSize };

  function renderSummary() {
    var list = state.published;
    var n = list.length;
    var avg = n ? list.reduce(function (s, r) { return s + r.rating; }, 0) / n : 0;
    $('[data-rv-avg]').textContent = n ? avg.toFixed(1) : '–';
    var starsHost = $('[data-rv-avg-stars]');
    var newStars = starsSVG(avg);
    newStars.setAttribute('data-rv-avg-stars', '');
    starsHost.replaceWith(newStars);
    $('[data-rv-count]').textContent = n ? ('Based on ' + n + ' review' + (n === 1 ? '' : 's')) : 'No reviews yet';

    var bars = $('[data-rv-bars]'); bars.textContent = '';
    for (var s = 5; s >= 1; s--) {
      var c = list.filter(function (r) { return r.rating === s; }).length;
      var row = el('div', 'rv-bar');
      row.appendChild(el('span', null, s + ' ★'));
      var track = el('span', 'track'); var fill = el('span', 'fill'); track.appendChild(fill); row.appendChild(track);
      row.appendChild(el('span', 'n', String(c)));
      row.setAttribute('aria-label', s + ' stars: ' + c);
      bars.appendChild(row);
      (function (f, w) { requestAnimationFrame(function () { f.style.width = w + '%'; }); })(fill, n ? (c / n) * 100 : 0);
    }

    var hero = $('[data-hero-rating]');
    if (hero) hero.textContent = n ? (avg.toFixed(1) + ' ★ · ' + n + ' review' + (n === 1 ? '' : 's')) : 'Be the first to review';

    var mode = $('[data-rv-mode]');
    mode.textContent = '';
    mode.appendChild(el('span', 'dot'));
    mode.appendChild(el('span', null, Store.source === 'database'
      ? 'Reviews are saved securely and approved by Austin before posting.'
      : 'Every review is sent to Austin and posted once approved.'));

    // Search-engine rating (only when there are real reviews)
    var old = document.getElementById('rv-jsonld'); if (old) old.remove();
    if (n) {
      var ld = el('script'); ld.type = 'application/ld+json'; ld.id = 'rv-jsonld';
      ld.textContent = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Fike Fix',
        telephone: '+1-912-585-2124', areaServed: 'Vidalia, GA',
        aggregateRating: { '@type': 'AggregateRating', ratingValue: avg.toFixed(1), reviewCount: n, bestRating: 5, worstRating: 1 }
      });
      document.head.appendChild(ld);
    }
  }

  function card(r) {
    var c = el('article', 'rv-card');
    var top = el('div', 'top');
    var who = el('div', 'rv-who');
    who.appendChild(el('span', 'rv-initial', r.name.charAt(0).toUpperCase()));
    var nm = el('div');
    nm.appendChild(el('div', 'rv-name', r.name));
    var meta = el('div', 'rv-meta');
    meta.appendChild(starsSVG(r.rating, true));
    var bits = [r.service, r.town].filter(Boolean).join(' · ');
    if (bits) { var b = el('span', null, '  ' + bits); b.style.marginLeft = '6px'; b.style.verticalAlign = 'top'; meta.appendChild(b); }
    nm.appendChild(meta);
    who.appendChild(nm);
    top.appendChild(who);
    var d = el('time', 'rv-date', fmtDate(r.created_at)); d.dateTime = r.created_at;
    top.appendChild(d);
    c.appendChild(top);
    c.appendChild(el('p', 'rv-text', r.comment));
    var pics = r.photoUrls.length ? r.photoUrls : r.thumbs;
    if (pics.length) {
      var g = el('div', 'rv-photos');
      pics.forEach(function (src, i) {
        var b = el('button', 'rv-photo'); b.type = 'button';
        b.setAttribute('aria-label', 'Open photo ' + (i + 1) + ' of ' + pics.length + ' from ' + r.name);
        var im = el('img'); im.src = src; im.alt = 'Photo from ' + r.name + "'s job"; im.loading = 'lazy'; im.decoding = 'async';
        b.appendChild(im);
        b.addEventListener('click', function () { openViewer(pics, i, r.name); });
        g.appendChild(b);
      });
      c.appendChild(g);
    }
    if (r.reply) {
      var rep = el('div', 'rv-reply'); rep.appendChild(el('b', null, 'Reply from Austin'));
      rep.appendChild(document.createTextNode(r.reply)); c.appendChild(rep);
    }
    if (r.pending) c.appendChild(el('span', 'rv-tag pending', 'Pending approval · only visible to you'));
    return c;
  }

  function renderList() {
    var host = $('[data-rv-list]'); host.textContent = '';
    var f = state.filter;
    var all = state.pending.concat(state.published).filter(function (r) {
      if (f === 'all') return true;
      if (f === 'low') return r.rating <= 3;
      return r.rating === +f;
    });
    all.sort(function (a, b) {
      if (a.pending !== b.pending) return a.pending ? -1 : 1;
      if (state.sort === 'high') return b.rating - a.rating || (b.created_at > a.created_at ? 1 : -1);
      if (state.sort === 'low') return a.rating - b.rating || (b.created_at > a.created_at ? 1 : -1);
      return b.created_at > a.created_at ? 1 : -1;
    });

    if (!all.length) {
      var empty = el('div', 'rv-empty');
      if (!state.published.length && f === 'all') {
        empty.appendChild(el('h3', null, 'No reviews yet'));
        empty.appendChild(el('p', null, 'Had a job done by Fike? Yours could be the first.'));
        var btn = el('button', 'btn primary', 'Write the first review'); btn.type = 'button';
        btn.addEventListener('click', openForm); empty.appendChild(btn);
      } else {
        empty.appendChild(el('h3', null, 'No reviews match that filter'));
        empty.appendChild(el('p', null, 'Try a different star rating.'));
      }
      host.appendChild(empty);
      $('[data-rv-more]').hidden = true;
      return;
    }
    all.slice(0, state.shown).forEach(function (r) { host.appendChild(card(r)); });
    $('[data-rv-more]').hidden = all.length <= state.shown;
  }

  function render() { renderSummary(); renderList(); }

  /* ---------------- Photo viewer ---------------- */
  var viewer = $('[data-rv-viewer]');
  var vState = { pics: [], i: 0, name: '' };
  function showPhoto() {
    var img = $('[data-rv-viewer-img]');
    img.src = vState.pics[vState.i];
    img.alt = 'Photo ' + (vState.i + 1) + ' from ' + vState.name;
    $('[data-rv-viewer-count]').textContent = vState.pics.length > 1 ? (vState.i + 1) + ' / ' + vState.pics.length : '';
    $$('[data-rv-viewer-nav]').forEach(function (b) { b.hidden = vState.pics.length < 2; });
  }
  function openViewer(pics, i, name) {
    vState = { pics: pics, i: i, name: name }; showPhoto();
    if (typeof viewer.showModal === 'function') viewer.showModal(); else viewer.setAttribute('open', '');
  }
  function step(d) { vState.i = (vState.i + d + vState.pics.length) % vState.pics.length; showPhoto(); }
  viewer.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-rv-viewer-nav]');
    if (nav) { step(+nav.dataset.rvViewerNav); return; }
    if (e.target.closest('[data-rv-viewer-close]') || e.target === viewer) { if (viewer.close) viewer.close(); else viewer.removeAttribute('open'); }
  });
  viewer.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });
  var touchX = null;
  viewer.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
  viewer.addEventListener('touchend', function (e) {
    if (touchX == null || vState.pics.length < 2) return;
    var dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  });

  async function refresh() {
    try {
      var data = await Store.list();
      state.published = data.published; state.pending = data.pending;
    } catch (e) {
      console.error(e);
    }
    render();
  }

  /* ---------------- Toolbar ---------------- */
  $$('[data-rv-filters] .chip').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('[data-rv-filters] .chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      state.filter = b.dataset.filter; state.shown = CFG.pageSize; renderList();
    });
  });
  $('[data-rv-sort]').addEventListener('change', function (e) { state.sort = e.target.value; renderList(); });
  $('[data-rv-more] button').addEventListener('click', function () { state.shown += CFG.pageSize; renderList(); });

  /* ---------------- Form ---------------- */
  var dialog = $('[data-rv-dialog]');
  var form = $('[data-rv-form]');
  var done = $('[data-rv-done]');
  var status = $('[data-rv-status]');
  var submitBtn = $('[data-rv-submit]');
  var WORDS = ['Tap a star', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

  // Star picker
  var starLabels = $$('[data-star-pick] label');
  starLabels.forEach(function (l) {
    l.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + STAR_PATH + '" fill="currentColor"/></svg>';
  });
  function paintStars(v) {
    starLabels.forEach(function (l, i) { l.classList.toggle('on', i < v); });
    $('[data-star-word]').textContent = WORDS[v] || WORDS[0];
  }
  function currentRating() { var c = form.querySelector('input[name=rating]:checked'); return c ? +c.value : 0; }
  starLabels.forEach(function (l, i) {
    l.addEventListener('mouseenter', function () { paintStars(i + 1); });
    l.addEventListener('mouseleave', function () { paintStars(currentRating()); });
  });
  $$('input[name=rating]', form).forEach(function (inp) {
    inp.addEventListener('change', function () { paintStars(currentRating()); setErr('rating', ''); });
  });

  var comment = form.elements.comment;
  comment.addEventListener('input', function () { $('[data-rv-chars]').textContent = comment.value.length + ' / 600'; });

  /* Photo picker: shrink each photo on the device (fast uploads, strips
   * hidden location data), keep up to CFG.maxPhotos. */
  var photoField = $('[data-rv-photo-field]');
  var photoInput = $('[data-rv-photo-input]');
  var photoList = $('[data-rv-photo-list]');
  var photoAdd = $('[data-rv-photo-add]');
  var picked = []; // { blob, thumb }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }
  function toJpeg(img, max, quality) {
    var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
    var cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return cv;
  }
  async function prepPhoto(file) {
    var img = await loadImage(file);
    var big = toJpeg(img, 1600);
    var blob = await new Promise(function (res) { big.toBlob(res, 'image/jpeg', 0.82); });
    if (!blob) throw new Error('unreadable');
    var thumb = toJpeg(img, 360).toDataURL('image/jpeg', 0.7);
    return { blob: blob, thumb: thumb };
  }
  function renderPicked() {
    photoList.textContent = '';
    picked.forEach(function (p, i) {
      var li = el('li', 'rv-pick');
      var im = el('img'); im.src = p.thumb; im.alt = 'Selected photo ' + (i + 1);
      li.appendChild(im);
      var x = el('button', 'rv-pick-x'); x.type = 'button'; x.setAttribute('aria-label', 'Remove photo ' + (i + 1));
      x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
      x.addEventListener('click', function () { picked.splice(i, 1); renderPicked(); });
      li.appendChild(x);
      photoList.appendChild(li);
    });
    photoAdd.hidden = picked.length >= CFG.maxPhotos;
    $('[data-rv-photo-count]').textContent = picked.length + ' / ' + CFG.maxPhotos;
  }
  if (photoField) {
    photoField.hidden = !hasSupabase;
    photoInput.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(photoInput.files || []);
      photoInput.value = '';
      setErr('photos', '');
      var room = CFG.maxPhotos - picked.length;
      if (files.length > room) setErr('photos', 'Up to ' + CFG.maxPhotos + ' photos. Only the first ' + room + ' were added.');
      files = files.slice(0, room);
      photoAdd.classList.add('busy');
      for (var i = 0; i < files.length; i++) {
        if (!/^image\//.test(files[i].type) && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(files[i].name)) {
          setErr('photos', 'That file is not a photo.'); continue;
        }
        try { picked.push(await prepPhoto(files[i])); }
        catch (e) { setErr('photos', 'One photo could not be opened. Try a JPEG or PNG.'); }
        renderPicked();
      }
      photoAdd.classList.remove('busy');
    });
    renderPicked();
  }

  function setErr(name, msg) { var e = form.querySelector('[data-err="' + name + '"]'); if (e) e.textContent = msg; }
  ['name', 'service', 'comment'].forEach(function (n) {
    form.elements[n].addEventListener('input', function () { setErr(n, ''); status.textContent = ''; });
    form.elements[n].addEventListener('change', function () { setErr(n, ''); });
  });

  function openForm() {
    form.hidden = false; done.hidden = true;
    if (photoField) photoField.hidden = Store.source !== 'database';
    $$('[data-err]', form).forEach(function (x) { x.textContent = ''; });
    status.textContent = ''; status.className = 'rv-status';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    setTimeout(function () { var first = form.querySelector('input[name=rating]'); if (first) first.focus(); }, 30);
  }
  function closeForm() { if (dialog.close) dialog.close(); else dialog.removeAttribute('open'); }

  $$('[data-rv-open]').forEach(function (b) { b.addEventListener('click', openForm); });
  dialog.addEventListener('click', function (e) {
    if (e.target.closest('[data-rv-close]')) { closeForm(); return; }
    if (e.target === dialog) closeForm(); // click on backdrop
  });

  function validate() {
    var ok = true;
    var rating = currentRating();
    var name = form.elements.name.value.trim();
    var service = form.elements.service.value;
    var text = comment.value.trim();
    setErr('rating', rating ? '' : 'Pick 1 to 5 stars.'); ok = ok && !!rating;
    setErr('name', name ? '' : 'Add your name (first name is fine).'); ok = ok && !!name;
    setErr('service', service ? '' : 'Choose the service you had done.'); ok = ok && !!service;
    setErr('comment', text.length >= 10 ? '' : 'Tell us a bit more (10+ characters).'); ok = ok && text.length >= 10;
    if (SERVICES.indexOf(service) === -1) ok = false;
    return ok;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (form.elements.website.value) { closeForm(); return; } // honeypot: silently drop bots
    if (!validate()) {
      status.textContent = 'Please fix the highlighted fields.'; status.className = 'rv-status bad';
      return;
    }
    var last = +(localStorage.getItem(LAST_SUBMIT_KEY) || 0);
    if (Date.now() - last < 60 * 1000) {
      status.textContent = 'You just sent a review. Please wait a minute before sending another.';
      status.className = 'rv-status bad'; return;
    }

    var review = clean({
      id: uid(),
      name: form.elements.name.value,
      town: form.elements.town.value,
      service: form.elements.service.value,
      rating: currentRating(),
      comment: comment.value,
      created_at: new Date().toISOString(),
      pending: true,
      thumbs: Store.source === 'database' ? picked.map(function (p) { return p.thumb; }) : []
    });
    review.files = Store.source === 'database' ? picked.slice() : [];

    submitBtn.disabled = true; submitBtn.textContent = review.files.length ? 'Uploading photos…' : 'Sending…';
    status.textContent = ''; status.className = 'rv-status';
    try {
      var result = await Store.submit(review);
      try { localStorage.setItem(LAST_SUBMIT_KEY, String(Date.now())); } catch (e2) {}
      var msg = $('[data-rv-done-msg]');
      msg.textContent = 'Austin will read it shortly. Once approved, it will appear here for everyone.';
      if (result.via === 'mailto') {
        msg.textContent = 'Your review is saved on this device. One more tap sends it to Austin: ';
        var a = el('a', null, 'email it to Fike'); a.href = result.mailto; a.style.fontWeight = '800';
        msg.appendChild(a); msg.appendChild(document.createTextNode('.'));
      }
      form.reset(); paintStars(0); picked = []; if (photoField) renderPicked(); $('[data-rv-chars]').textContent = '0 / 600';
      form.hidden = true; done.hidden = false;
      state.pending = local.read().map(function (r) { r.pending = true; return r; });
      state.filter = 'all';
      $$('[data-rv-filters] .chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.filter === 'all')); });
      renderList();
    } catch (err) {
      status.textContent = err.message || 'Something went wrong. Please try again.';
      status.className = 'rv-status bad';
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Submit review';
    }
  });

  paintStars(0);
  refresh();
})();
