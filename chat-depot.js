/* ============================================================================
 * chat-depot.js — Fil de discussion dans le dossier de dépôt artiste
 * ----------------------------------------------------------------------------
 * SOURCE UNIQUE. Ce fichier est IDENTIQUE (octet pour octet) dans les trois
 * dépôts : labrassee-surlascene-depot, labrassee-murs-depot,
 * labrassee-pages-depot. Ne jamais le diverger : corriger ici, puis recopier.
 *
 * Objectif : l'artiste pose ses questions DANS son dossier, plutôt que par
 * courriel / iMessage / Facebook / Instagram. Apollon voit et répond ; en cas
 * de doute, il fait remonter à Cédric. Le courriel ne disparaît pas — il
 * devient la notification, plus le canal.
 *
 * Intégration dans un index.html de dépôt (1 ligne, juste avant </body>) :
 *   <script src="/chat-depot.js" data-plateforme="scene"
 *           data-url="https://xxx.supabase.co" data-key="ANON_KEY"></script>
 * Le module construit lui-même son bouton et son panneau : aucun conteneur
 * à prévoir dans la page, aucune classe CSS existante n'est touchée.
 *
 * Aucune dépendance : appels REST directs sur les RPC token-gated
 * (depot_chat_fils / _messages / _ouvrir / _repondre). Le SDK supabase-js
 * n'est pas requis, donc aucun problème d'ordre de chargement.
 *
 * Forgé le 2026-07-26 par Héphaïstos.
 * ========================================================================== */
(function () {
  'use strict';

  var script = document.currentScript ||
    document.querySelector('script[src*="chat-depot.js"]');
  if (!script) return;

  var PLATEFORME = script.getAttribute('data-plateforme');
  var SUPA_URL = (script.getAttribute('data-url') || '').replace(/\/+$/, '');
  var SUPA_KEY = script.getAttribute('data-key') || '';
  if (!PLATEFORME || !SUPA_URL || !SUPA_KEY) return;

  // Le fil vit dans un dossier : sans token (candidature spontanée), pas de chat.
  var TOKEN = new URLSearchParams(window.location.search).get('t');
  if (!TOKEN) return;

  var POLL_MS = 20000;
  var etat = { ouvert: false, vue: 'liste', fils: [], filActif: null, msgs: [], busy: false, timer: null };

  /* ---------------------------------------------------------------- réseau */
  function rpc(fn, payload) {
    return fetch(SUPA_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  var ERREURS = {
    token_invalide: "Ton lien de dossier n'est plus valide. Réponds au dernier courriel de La Brassée et on te renvoie un lien.",
    sujet_invalide: 'Donne un sujet un peu plus explicite (3 caractères minimum).',
    contenu_invalide: 'Ton message est vide ou dépasse 4000 caractères.',
    trop_de_fils: "Tu as beaucoup de fils ouverts. Continue plutôt dans un fil existant.",
    trop_rapide: 'Doucement — attends quelques secondes avant de renvoyer.',
    fil_introuvable: 'Ce fil est introuvable.',
    fil_plein: 'Ce fil est très long. Ouvre une nouvelle question.'
  };
  function messageErreur(code) {
    return ERREURS[code] || "Ça n'a pas fonctionné. Réessaie dans un instant.";
  }

  /* ------------------------------------------------------------------ util */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Toute date affichée est en heure de Montréal.
  function dateMtl(iso) {
    try {
      var d = new Date(iso);
      var jour = new Intl.DateTimeFormat('fr-CA', {
        timeZone: 'America/Toronto', day: 'numeric', month: 'long'
      }).format(d);
      var heure = new Intl.DateTimeFormat('fr-CA', {
        timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(d);
      return jour + ' à ' + heure;
    } catch (e) { return ''; }
  }

  // L'artiste ne voit pas la mécanique interne (qui répond, escalade ou non).
  function statutLisible(statut) {
    if (statut === 'resolu' || statut === 'ferme') return { texte: 'Réglé', classe: 'cd-st-ok' };
    return { texte: 'En attente de réponse', classe: 'cd-st-attente' };
  }

  function totalNonLus() {
    return etat.fils.reduce(function (n, f) { return n + (f.non_lus || 0); }, 0);
  }

  /* -------------------------------------------------------------------- css */
  var CSS = [
    '#cd-bulle{position:fixed;right:18px;bottom:18px;z-index:9000;display:flex;align-items:center;gap:9px;',
    'padding:13px 19px;border-radius:999px;border:1px solid var(--jaune-fort,rgba(247,209,53,.5));',
    'background:linear-gradient(135deg,rgba(247,209,53,.22),rgba(247,209,53,.08));',
    'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
    'box-shadow:0 8px 32px rgba(0,0,0,.45);color:var(--blanc,#fff);cursor:pointer;',
    "font-family:var(--font-corps,'Lato',sans-serif);font-size:15px;font-weight:600;",
    'transition:transform .18s ease,box-shadow .18s ease}',
    '#cd-bulle:hover{transform:translateY(-2px);box-shadow:0 12px 38px rgba(0,0,0,.55)}',
    '#cd-bulle .cd-pastille{min-width:21px;height:21px;padding:0 6px;border-radius:999px;',
    'background:var(--rouge,#ff6b6b);color:#fff;font-size:12px;font-weight:700;',
    'display:none;align-items:center;justify-content:center}',
    '#cd-bulle.cd-a-lire .cd-pastille{display:flex}',

    '#cd-voile{position:fixed;inset:0;z-index:9001;background:rgba(6,6,4,.62);',
    'backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:none}',
    '#cd-voile.cd-on{display:block}',

    '#cd-panneau{position:fixed;z-index:9002;right:0;top:0;bottom:0;width:min(440px,100vw);',
    'display:none;flex-direction:column;background:var(--sombre,#100f09);',
    'border-left:1px solid var(--glass-border,rgba(255,255,255,.12));',
    "font-family:var(--font-corps,'Lato',sans-serif);color:var(--blanc-doux,rgba(255,255,255,.85))}",
    '#cd-panneau.cd-on{display:flex}',
    '@media(max-width:520px){#cd-panneau{width:100vw;border-left:none}}',

    '.cd-entete{display:flex;align-items:center;gap:12px;padding:18px 20px;',
    'border-bottom:1px solid var(--glass-border,rgba(255,255,255,.12));flex-shrink:0}',
    '.cd-entete h3{margin:0;flex:1;font-size:19px;color:var(--jaune,#f7d135);',
    "font-family:var(--font-titre,'Oswald',sans-serif);font-weight:500;letter-spacing:.02em}",
    '.cd-ico{background:none;border:none;color:var(--gris,rgba(255,255,255,.55));font-size:22px;',
    'cursor:pointer;padding:4px 8px;line-height:1;border-radius:8px}',
    '.cd-ico:hover{color:var(--blanc,#fff);background:rgba(255,255,255,.07)}',

    '.cd-corps{flex:1;overflow-y:auto;padding:18px 20px;-webkit-overflow-scrolling:touch}',
    '.cd-intro{font-size:13.5px;line-height:1.55;color:var(--gris,rgba(255,255,255,.55));margin:0 0 18px}',

    '.cd-fil{width:100%;text-align:left;display:block;padding:14px 16px;margin-bottom:10px;',
    'border-radius:13px;border:1px solid var(--glass-border,rgba(255,255,255,.12));',
    'background:var(--glass-bg,rgba(255,255,255,.04));color:inherit;cursor:pointer;',
    'font-family:inherit;font-size:15px;transition:border-color .15s ease,background .15s ease}',
    '.cd-fil:hover{border-color:var(--jaune-fort,rgba(247,209,53,.5));background:var(--glass-bg-fort,rgba(255,255,255,.07))}',
    '.cd-fil .cd-fil-h{display:flex;align-items:flex-start;gap:9px}',
    '.cd-fil .cd-sujet{flex:1;font-weight:600;color:var(--blanc,#fff);line-height:1.35}',
    '.cd-fil .cd-meta{margin-top:7px;font-size:12px;color:var(--gris,rgba(255,255,255,.55))}',
    '.cd-badge{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--rouge,#ff6b6b);',
    'color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '.cd-st{display:inline-block;margin-top:8px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600}',
    '.cd-st-attente{background:rgba(247,209,53,.15);color:var(--jaune,#f7d135)}',
    '.cd-st-ok{background:rgba(138,214,114,.15);color:var(--vert,#8ad672)}',

    '.cd-vide{text-align:center;padding:30px 10px;color:var(--gris,rgba(255,255,255,.55));font-size:14px;line-height:1.6}',

    '.cd-msg{margin-bottom:14px;display:flex}',
    '.cd-msg.cd-moi{justify-content:flex-end}',
    '.cd-msg .cd-bulle{max-width:82%;padding:11px 15px;border-radius:16px;font-size:14.5px;',
    'line-height:1.5;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
    '.cd-msg.cd-moi .cd-bulle{background:rgba(247,209,53,.16);',
    'border:1px solid var(--jaune-trame,rgba(247,209,53,.3));border-bottom-right-radius:5px}',
    '.cd-msg.cd-eux .cd-bulle{background:var(--glass-bg-fort,rgba(255,255,255,.07));',
    'border:1px solid var(--glass-border,rgba(255,255,255,.12));border-bottom-left-radius:5px}',
    '.cd-msg .cd-h{font-size:11px;color:var(--gris,rgba(255,255,255,.55));margin-bottom:5px}',

    '.cd-pied{flex-shrink:0;padding:14px 20px 18px;border-top:1px solid var(--glass-border,rgba(255,255,255,.12));',
    'background:var(--noir-pur,#0a0905)}',
    '.cd-champ{width:100%;padding:12px 14px;border-radius:12px;',
    'border:1px solid var(--glass-border,rgba(255,255,255,.12));background:rgba(255,255,255,.06);',
    'color:var(--blanc,#fff);font-size:16px;font-family:inherit;outline:none;resize:vertical;',
    'box-sizing:border-box;margin-bottom:10px}',
    '.cd-champ:focus{border-color:var(--jaune-fort,rgba(247,209,53,.5))}',
    '.cd-champ::placeholder{color:rgba(255,255,255,.35)}',
    '.cd-btn{width:100%;padding:13px 16px;border-radius:12px;border:none;background:var(--jaune,#f7d135);',
    'color:var(--sombre,#100f09);font-size:15px;font-weight:700;font-family:inherit;cursor:pointer}',
    '.cd-btn:disabled{opacity:.5;cursor:default}',
    '.cd-btn-2{background:transparent;border:1px solid var(--glass-border,rgba(255,255,255,.12));',
    'color:var(--blanc-doux,rgba(255,255,255,.85))}',
    '.cd-alerte{padding:10px 13px;border-radius:10px;background:rgba(255,107,107,.13);',
    'border:1px solid rgba(255,107,107,.35);color:var(--rouge,#ff6b6b);font-size:13px;',
    'line-height:1.45;margin-bottom:10px}'
  ].join('');

  /* ------------------------------------------------------------------- DOM */
  var elBulle, elVoile, elPanneau, elCorps, elPied, elTitre, elRetour;

  function monter() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    elBulle = document.createElement('button');
    elBulle.id = 'cd-bulle';
    elBulle.type = 'button';
    elBulle.setAttribute('aria-label', 'Ouvrir mes questions');
    elBulle.innerHTML = '<span>💬 Une question ?</span><span class="cd-pastille">0</span>';
    elBulle.addEventListener('click', ouvrir);

    elVoile = document.createElement('div');
    elVoile.id = 'cd-voile';
    elVoile.addEventListener('click', fermer);

    elPanneau = document.createElement('aside');
    elPanneau.id = 'cd-panneau';
    elPanneau.setAttribute('role', 'dialog');
    elPanneau.setAttribute('aria-label', 'Mes questions à La Brassée');
    elPanneau.innerHTML =
      '<div class="cd-entete">' +
        '<button class="cd-ico" id="cd-retour" type="button" style="display:none" aria-label="Retour">‹</button>' +
        '<h3 id="cd-titre">Mes questions</h3>' +
        '<button class="cd-ico" id="cd-fermer" type="button" aria-label="Fermer">×</button>' +
      '</div>' +
      '<div class="cd-corps" id="cd-corps"></div>' +
      '<div class="cd-pied" id="cd-pied"></div>';

    document.body.appendChild(elBulle);
    document.body.appendChild(elVoile);
    document.body.appendChild(elPanneau);

    elCorps = document.getElementById('cd-corps');
    elPied = document.getElementById('cd-pied');
    elTitre = document.getElementById('cd-titre');
    elRetour = document.getElementById('cd-retour');
    document.getElementById('cd-fermer').addEventListener('click', fermer);
    elRetour.addEventListener('click', function () { etat.vue = 'liste'; etat.filActif = null; rendre(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && etat.ouvert) fermer();
    });
  }

  /* --------------------------------------------------------------- données */
  function chargerFils() {
    return rpc('depot_chat_fils', { p_plateforme: PLATEFORME, p_token: TOKEN })
      .then(function (res) {
        if (!res || !res.ok) return;
        etat.fils = res.fils || [];
        var n = totalNonLus();
        elBulle.classList.toggle('cd-a-lire', n > 0);
        elBulle.querySelector('.cd-pastille').textContent = n > 9 ? '9+' : String(n);
      })
      .catch(function () { /* silencieux : le dépôt ne doit jamais casser pour ça */ });
  }

  function chargerMessages(threadId) {
    return rpc('depot_chat_messages', {
      p_plateforme: PLATEFORME, p_token: TOKEN, p_thread_id: threadId
    }).then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.erreur);
      etat.msgs = res.messages || [];
    });
  }

  /* ----------------------------------------------------------------- vues */
  function rendre() {
    if (etat.vue === 'liste') return rendreListe();
    if (etat.vue === 'nouveau') return rendreNouveau();
    return rendreFil();
  }

  function rendreListe() {
    elTitre.textContent = 'Mes questions';
    elRetour.style.display = 'none';

    var html = '<p class="cd-intro">Pose tes questions ici plutôt que par courriel ou message privé : ' +
      'tout reste rattaché à ton dossier, et on te répond au même endroit. ' +
      'Tu reçois un courriel dès qu\'on te répond.</p>';

    if (!etat.fils.length) {
      html += '<div class="cd-vide">Aucune question pour l\'instant.<br>Écris-nous quand tu veux.</div>';
    } else {
      etat.fils.forEach(function (f) {
        var st = statutLisible(f.statut);
        var qui = f.dernier_auteur === 'artiste' ? 'Toi' : 'La Brassée';
        html += '<button class="cd-fil" type="button" data-id="' + esc(f.id) + '">' +
          '<span class="cd-fil-h"><span class="cd-sujet">' + esc(f.sujet) + '</span>' +
          (f.non_lus > 0 ? '<span class="cd-badge">' + f.non_lus + '</span>' : '') +
          '</span>' +
          '<span class="cd-meta">' + qui + ' · ' + esc(dateMtl(f.dernier_message_at)) + '</span><br>' +
          '<span class="cd-st ' + st.classe + '">' + st.texte + '</span>' +
          '</button>';
      });
    }
    elCorps.innerHTML = html;
    Array.prototype.forEach.call(elCorps.querySelectorAll('.cd-fil'), function (b) {
      b.addEventListener('click', function () { ouvrirFil(b.getAttribute('data-id')); });
    });

    elPied.innerHTML = '<button class="cd-btn" id="cd-nouveau" type="button">Poser une question</button>';
    document.getElementById('cd-nouveau').addEventListener('click', function () {
      etat.vue = 'nouveau'; rendre();
    });
  }

  function rendreNouveau() {
    elTitre.textContent = 'Nouvelle question';
    elRetour.style.display = 'block';
    elCorps.innerHTML = '<p class="cd-intro">Un sujet clair nous aide à te répondre vite ' +
      '(ex. « Heure du soundcheck », « Stationnement », « Format des photos »).</p>' +
      '<div id="cd-err"></div>';
    elPied.innerHTML =
      '<input class="cd-champ" id="cd-sujet" type="text" maxlength="140" placeholder="Sujet — ex. Heure du soundcheck">' +
      '<textarea class="cd-champ" id="cd-texte" rows="4" maxlength="4000" placeholder="Ta question…"></textarea>' +
      '<button class="cd-btn" id="cd-envoi" type="button">Envoyer</button>';

    document.getElementById('cd-envoi').addEventListener('click', function () {
      var sujet = document.getElementById('cd-sujet').value;
      var texte = document.getElementById('cd-texte').value;
      if (etat.busy) return;
      etat.busy = true;
      var btn = document.getElementById('cd-envoi');
      btn.disabled = true; btn.textContent = 'Envoi…';

      rpc('depot_chat_ouvrir', {
        p_plateforme: PLATEFORME, p_token: TOKEN, p_sujet: sujet, p_contenu: texte
      }).then(function (res) {
        etat.busy = false;
        if (!res || !res.ok) {
          document.getElementById('cd-err').innerHTML =
            '<div class="cd-alerte">' + esc(messageErreur(res && res.erreur)) + '</div>';
          btn.disabled = false; btn.textContent = 'Envoyer';
          return;
        }
        return chargerFils().then(function () { ouvrirFil(res.thread_id); });
      }).catch(function () {
        etat.busy = false;
        document.getElementById('cd-err').innerHTML =
          '<div class="cd-alerte">' + esc(messageErreur()) + '</div>';
        btn.disabled = false; btn.textContent = 'Envoyer';
      });
    });
  }

  function rendreFil() {
    var fil = etat.filActif;
    elTitre.textContent = fil ? fil.sujet : 'Fil';
    elRetour.style.display = 'block';

    var html = '';
    etat.msgs.forEach(function (m) {
      var moi = m.de === 'artiste';
      html += '<div class="cd-msg ' + (moi ? 'cd-moi' : 'cd-eux') + '"><div>' +
        '<div class="cd-h" style="text-align:' + (moi ? 'right' : 'left') + '">' +
          (moi ? 'Toi' : 'La Brassée') + ' · ' + esc(dateMtl(m.created_at)) +
        '</div><div class="cd-bulle">' + esc(m.contenu) + '</div>' +
      '</div></div>';
    });
    elCorps.innerHTML = html + '<div id="cd-bas"></div><div id="cd-err"></div>';
    var bas = document.getElementById('cd-bas');
    if (bas && bas.scrollIntoView) bas.scrollIntoView({ block: 'end' });

    elPied.innerHTML =
      '<textarea class="cd-champ" id="cd-texte" rows="3" maxlength="4000" placeholder="Ta réponse…"></textarea>' +
      '<button class="cd-btn" id="cd-envoi" type="button">Envoyer</button>';

    document.getElementById('cd-envoi').addEventListener('click', function () {
      if (etat.busy || !fil) return;
      var texte = document.getElementById('cd-texte').value;
      etat.busy = true;
      var btn = document.getElementById('cd-envoi');
      btn.disabled = true; btn.textContent = 'Envoi…';

      rpc('depot_chat_repondre', {
        p_plateforme: PLATEFORME, p_token: TOKEN, p_thread_id: fil.id, p_contenu: texte
      }).then(function (res) {
        etat.busy = false;
        if (!res || !res.ok) {
          document.getElementById('cd-err').innerHTML =
            '<div class="cd-alerte">' + esc(messageErreur(res && res.erreur)) + '</div>';
          btn.disabled = false; btn.textContent = 'Envoyer';
          return;
        }
        return chargerMessages(fil.id).then(function () { chargerFils(); rendre(); });
      }).catch(function () {
        etat.busy = false;
        document.getElementById('cd-err').innerHTML =
          '<div class="cd-alerte">' + esc(messageErreur()) + '</div>';
        btn.disabled = false; btn.textContent = 'Envoyer';
      });
    });
  }

  function ouvrirFil(id) {
    var fil = null;
    for (var i = 0; i < etat.fils.length; i++) {
      if (etat.fils[i].id === id) { fil = etat.fils[i]; break; }
    }
    etat.filActif = fil || { id: id, sujet: 'Fil' };
    etat.vue = 'fil';
    elCorps.innerHTML = '<div class="cd-vide">Chargement…</div>';
    elPied.innerHTML = '';
    chargerMessages(id)
      .then(function () { rendre(); return chargerFils(); })
      .catch(function () {
        elCorps.innerHTML = '<div class="cd-alerte">' + esc(messageErreur()) + '</div>';
      });
  }

  /* ------------------------------------------------------------ ouverture */
  function ouvrir() {
    etat.ouvert = true;
    etat.vue = 'liste';
    etat.filActif = null;
    elVoile.classList.add('cd-on');
    elPanneau.classList.add('cd-on');
    elCorps.innerHTML = '<div class="cd-vide">Chargement…</div>';
    elPied.innerHTML = '';
    chargerFils().then(rendre);

    etat.timer = setInterval(function () {
      if (etat.vue === 'fil' && etat.filActif) {
        chargerMessages(etat.filActif.id).then(function () {
          if (etat.vue === 'fil') rendre();
        }).catch(function () {});
      } else {
        chargerFils().then(function () { if (etat.vue === 'liste') rendre(); });
      }
    }, POLL_MS);
  }

  function fermer() {
    etat.ouvert = false;
    elVoile.classList.remove('cd-on');
    elPanneau.classList.remove('cd-on');
    if (etat.timer) { clearInterval(etat.timer); etat.timer = null; }
    chargerFils();
  }

  /* --------------------------------------------------------------- amorce */
  function demarrer() {
    monter();
    chargerFils();
    // Le badge se rafraîchit doucement même panneau fermé.
    setInterval(function () { if (!etat.ouvert) chargerFils(); }, 120000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }
})();
