// Customer-side languages: English and French. Picked automatically from the phone language.
const D = {
  en: {
    ext_title: 'Watch with the app or your IPTV player', ext_text: 'On this device, channels open in an IPTV player. On Android phones and TVs, install our app to watch inside it.', ext_android: '📲 Get the Android / TV app', ext_vlc: '▶ Open playlist in VLC', ext_details: 'Your IPTV details (IPTV Smarters, TiviMate, XCIPTV…)', copied: 'Copied ✓', copyAll: '📋 Copy details', dns: 'DNS / Server',
    lineInactive: 'Your IPTV line is not active on the server yet. Please contact support.', lineBad: 'The IPTV server returned an unexpected answer.', retry: 'Try again',
    apps_title: 'Watch in the INTPROTO-TV app', apps_text: 'Install the free app for your phone, TV or computer to watch here. It updates by itself.', relayDown: 'The stream relay is starting up. Please try again in a minute.', plansTitle: 'Plans & prices', choose: 'Choose', whatsapp: 'WhatsApp', waMsg: 'Hello {app}, I need help. My username: {u}', waBuy: 'Hello {app}, I want the {pkg} package ({price}). My username: {u}', payNow: '💳 Pay now', requestBuy: 'Request this package', requested: 'Request sent — we will contact you', requestSent: 'Request sent ✓ We will send you the payment link.', buyHow: 'Tap Request or write us on WhatsApp: we send you your personal payment link.', emailMe: '📧 Email me', offerSent: 'Sent to {email} ✓', buyTitle: 'Choose your package', daysN: '{n} days', noEmail: 'Add your email first (contact us on WhatsApp).',
    openingPlayer: 'Opening the player…',
    off: 'Off', noSubs: 'No subtitles in this stream', oneAudio: 'Only one audio track', speed: 'Speed',
    welcome: 'Welcome back', loginSub: 'Sign in with the login details you received.', tagline: 'Live TV · Movies · Series',
    username: 'Username', password: 'Password', signIn: 'Sign in', language: 'Language',
    startTrial: 'Start your free {hours}h trial', trialTitle: 'Free {hours}-hour trial', trialIntro: 'Enter your details. Your login will be sent to your email.',
    fullName: 'Full name', email: 'Email', phone: 'Phone number', whatsapp: 'WhatsApp number', sameWhatsapp: 'My WhatsApp is the same number',
    getTrial: 'Get my free trial', cancel: 'Cancel', trialSent: 'Done! 🎉 Check your email ({email}) for your login details. Look in Spam too.',
    trialShown: 'Your free trial is ready 🎉 Save these details:', haveAccount: 'Back to sign in',
    trial_used: 'A free trial was already used with this email or phone number.', trial_invalid: 'Please enter your name, a valid email and phone number.',
    trial_ip: 'Too many trials from this network today. Please try again tomorrow.', trial_off: 'Free trials are not available right now.', trial_panel: 'We could not create your trial right now. Please contact support.',
    wrongLogin: 'Wrong username or password.', disabled: 'This account is disabled. Please contact support.',
    home: 'Home', live: 'Live', movies: 'Movies', series: 'Series', account: 'Account', liveTv: 'Live TV', support: 'Contact support',
    hello: 'Hello, {name} 👋', mySub: 'MY SUBSCRIPTION', daysLeft: 'days left', hoursLeft: 'hours left', until: 'until {date}', devices: '{n} device(s)',
    st_active: 'active', st_expiring: 'expiring', st_expired: 'expired', st_disabled: 'disabled', trial: 'Free trial',
    expiringSoon: 'Your subscription ends in {n} day(s).', trialEnds: 'Your free trial ends in {n} hour(s).', renewNow: 'Renew now', contactRenew: 'Contact us to renew.',
    expiredOn: 'Your subscription expired on {date}.', expiredTitle: 'Your subscription has expired', expiredText: 'Expired on {date}. Renew to keep watching.',
    maintTitle: 'Under maintenance', notReady: 'Not available yet', notReadyText: "The streaming server isn't set up yet. Please contact support.",
    favorites: '⭐ Favorites', search: '🔎 Search in this category…', all: 'All', nothing: 'Nothing found.', more: 'Show more ({n})',
    play: '▶ Play', tvGuide: 'TV guide', season: 'Season {n}', noEps: 'No episodes yet.', streamFail: '⚠️ This stream could not be played. Try another one or contact support.',
    status: 'Status', plan: 'Plan', started: 'Started', expires: 'Expires', devicesL: 'Devices', history: 'History', startedOn: 'Started', renewed: 'Renewed',
    changePw: 'Change password', currentPw: 'Current password', newPw: 'New password', updatePw: 'Update password', pwUpdated: 'Password updated ✓',
    logout: 'Log out', getApp: 'Get the app', notAvailable: 'Playback is not available right now.', demo: 'Demo mode · data stays in this browser',
  },
  fr: {
    ext_title: "Regardez avec l'application ou votre lecteur IPTV", ext_text: "Sur cet appareil, les chaînes s'ouvrent dans un lecteur IPTV. Sur Android et TV, installez notre application pour regarder directement.", ext_android: "📲 Application Android / TV", ext_vlc: '▶ Ouvrir la playlist dans VLC', ext_details: 'Vos informations IPTV (IPTV Smarters, TiviMate, XCIPTV…)', copied: 'Copié ✓', copyAll: '📋 Copier', dns: 'DNS / Serveur',
    lineInactive: "Votre ligne IPTV n'est pas encore active sur le serveur. Contactez le support.", lineBad: 'Le serveur IPTV a renvoyé une réponse inattendue.', retry: 'Réessayer',
    apps_title: "Regardez dans l'application INTPROTO-TV", apps_text: "Installez l'application gratuite pour votre téléphone, TV ou ordinateur. Elle se met à jour toute seule.", relayDown: 'Le relais démarre. Réessayez dans une minute.', plansTitle: 'Formules & prix', choose: 'Choisir', whatsapp: 'WhatsApp', waMsg: "Bonjour {app}, j'ai besoin d'aide. Mon identifiant : {u}", waBuy: 'Bonjour {app}, je veux la formule {pkg} ({price}). Mon identifiant : {u}', payNow: '💳 Payer', requestBuy: 'Demander cette formule', requested: 'Demande envoyée — nous vous contactons', requestSent: 'Demande envoyée ✓ Nous vous envoyons le lien de paiement.', buyHow: 'Appuyez sur Demander ou écrivez-nous sur WhatsApp : nous vous envoyons votre lien de paiement personnel.', emailMe: '📧 Recevoir par email', offerSent: 'Envoyé à {email} ✓', buyTitle: 'Choisissez votre formule', daysN: '{n} jours', noEmail: 'Ajoutez votre email (contactez-nous sur WhatsApp).',
    openingPlayer: 'Ouverture du lecteur…',
    off: 'Désactivés', noSubs: 'Pas de sous-titres pour ce flux', oneAudio: 'Une seule piste audio', speed: 'Vitesse',
    welcome: 'Bon retour', loginSub: 'Connectez-vous avec les identifiants reçus.', tagline: 'TV en direct · Films · Séries',
    username: "Nom d'utilisateur", password: 'Mot de passe', signIn: 'Se connecter', language: 'Langue',
    startTrial: 'Essai gratuit de {hours}h', trialTitle: 'Essai gratuit de {hours} heures', trialIntro: 'Entrez vos informations. Vos identifiants seront envoyés par e-mail.',
    fullName: 'Nom complet', email: 'E-mail', phone: 'Numéro de téléphone', whatsapp: 'Numéro WhatsApp', sameWhatsapp: 'Mon WhatsApp est le même numéro',
    getTrial: 'Obtenir mon essai gratuit', cancel: 'Annuler', trialSent: "C'est fait ! 🎉 Consultez votre e-mail ({email}) pour vos identifiants. Vérifiez aussi les spams.",
    trialShown: 'Votre essai gratuit est prêt 🎉 Gardez ces informations :', haveAccount: 'Retour à la connexion',
    trial_used: 'Un essai gratuit a déjà été utilisé avec cet e-mail ou ce numéro.', trial_invalid: 'Veuillez entrer votre nom, un e-mail et un numéro valides.',
    trial_ip: "Trop d'essais depuis ce réseau aujourd'hui. Réessayez demain.", trial_off: 'Les essais gratuits ne sont pas disponibles pour le moment.', trial_panel: "Impossible de créer votre essai pour l'instant. Contactez le support.",
    wrongLogin: "Nom d'utilisateur ou mot de passe incorrect.", disabled: 'Ce compte est désactivé. Contactez le support.',
    home: 'Accueil', live: 'Direct', movies: 'Films', series: 'Séries', account: 'Compte', liveTv: 'TV en direct', support: 'Contacter le support',
    hello: 'Bonjour, {name} 👋', mySub: 'MON ABONNEMENT', daysLeft: 'jours restants', hoursLeft: 'heures restantes', until: "jusqu'au {date}", devices: '{n} appareil(s)',
    st_active: 'actif', st_expiring: 'expire bientôt', st_expired: 'expiré', st_disabled: 'désactivé', trial: 'Essai gratuit',
    expiringSoon: 'Votre abonnement se termine dans {n} jour(s).', trialEnds: 'Votre essai gratuit se termine dans {n} heure(s).', renewNow: 'Renouveler', contactRenew: 'Contactez-nous pour renouveler.',
    expiredOn: 'Votre abonnement a expiré le {date}.', expiredTitle: 'Votre abonnement a expiré', expiredText: 'Expiré le {date}. Renouvelez pour continuer à regarder.',
    maintTitle: 'En maintenance', notReady: 'Pas encore disponible', notReadyText: "Le serveur n'est pas encore configuré. Contactez le support.",
    favorites: '⭐ Favoris', search: '🔎 Rechercher dans cette catégorie…', all: 'Tout', nothing: 'Aucun résultat.', more: 'Voir plus ({n})',
    play: '▶ Lire', tvGuide: 'Guide TV', season: 'Saison {n}', noEps: "Pas encore d'épisodes.", streamFail: '⚠️ Impossible de lire ce flux. Essayez-en un autre ou contactez le support.',
    status: 'Statut', plan: 'Formule', started: 'Début', expires: 'Expire le', devicesL: 'Appareils', history: 'Historique', startedOn: 'Début', renewed: 'Renouvelé',
    changePw: 'Changer le mot de passe', currentPw: 'Mot de passe actuel', newPw: 'Nouveau mot de passe', updatePw: 'Mettre à jour', pwUpdated: 'Mot de passe mis à jour ✓',
    logout: 'Se déconnecter', getApp: "Télécharger l'application", notAvailable: 'La lecture est indisponible pour le moment.', demo: 'Mode démo · données dans ce navigateur',
  },
};


// ---- account portal, library and sign-in help ----
Object.assign(D.en, {
  forgot: 'Forgot password?', forgotText: 'Enter your username or your email. If the account has an email address, we send a link to choose a new password.', loginOrEmail: 'Username or email', sendLink: 'Send the link', forgotSent: 'If the account exists and has an email address, the link is on its way. It works for 30 minutes.',
  resetTitle: 'Choose a new password', resetDone: 'Password changed. You can sign in now.', reset_bad: 'This link is not valid any more. Ask for a new one.', aboutSite: 'About {app}',
  code2fa: '6-digit code', code2faTitle: 'Two-step sign-in', code2faText: 'Open your authenticator app and enter the code for this account.', verify: 'Verify',
  devicesT: 'My devices', thisDevice: 'This device', signedInOn: 'Signed in {date}', signOutDev: 'Sign out', noDevices: 'No devices are signed in.', devOut: 'Device signed out.',
  supportT: 'Support requests', newTicket: 'New request', subject: 'Subject', message: 'Message', send: 'Send', reply: 'Reply', writeReply: 'Write a reply…',
  ticket_short: 'Please write a subject and a longer message.', ticket_limit: 'You can open 3 requests per day. Please reply inside an existing one.', ticket_full: 'This request is full. Please open a new one.',
  noTickets: 'No requests yet. Tell us what you need help with.', st_open: 'Waiting for us', st_answered: 'Answered', st_closed: 'Closed', ticketSent: 'Sent. We answer here.', you: 'You', supportTeam: 'Support',
  paymentsT: 'Payments', noPayments: 'No payments yet.', receipt: 'Receipt', print: 'Print', receiptFor: 'Receipt for', paidOn: 'Paid on', amount: 'Amount', item: 'Item', reference: 'Reference',
  continueW: 'Continue watching', recentCh: 'Recently watched', clearHist: 'Clear history', histCleared: 'History cleared.', resumed: 'Resumed from {t}',
  parentalT: 'Parental controls', parentalText: 'Hide adult categories on this device until the PIN is entered.', pin: '4-digit PIN', setPin: 'Turn on', pinOnText: 'Adult categories are hidden on this device.', removePin: 'Turn off', enterPin: 'Enter the PIN', wrongPin: 'Wrong PIN.', pinNeeds: 'The PIN needs 4 digits.', unlock: 'Unlock', locked: '🔒 Locked', pinSaved: 'Parental controls are on.', pinRemoved: 'Parental controls are off.',
  libraryT: 'My library', loadingDots: 'Loading…',
});
Object.assign(D.fr, {
  forgot: 'Mot de passe oublié ?', forgotText: 'Saisissez votre nom d’utilisateur ou votre e-mail. Si le compte a une adresse e-mail, nous envoyons un lien pour choisir un nouveau mot de passe.', loginOrEmail: 'Nom d’utilisateur ou e-mail', sendLink: 'Envoyer le lien', forgotSent: 'Si le compte existe et a une adresse e-mail, le lien est en route. Il est valable 30 minutes.',
  resetTitle: 'Choisir un nouveau mot de passe', resetDone: 'Mot de passe modifié. Vous pouvez vous connecter.', reset_bad: 'Ce lien n’est plus valable. Demandez-en un nouveau.', aboutSite: 'À propos de {app}',
  code2fa: 'Code à 6 chiffres', code2faTitle: 'Connexion en deux étapes', code2faText: 'Ouvrez votre application d’authentification et saisissez le code de ce compte.', verify: 'Vérifier',
  devicesT: 'Mes appareils', thisDevice: 'Cet appareil', signedInOn: 'Connecté le {date}', signOutDev: 'Déconnecter', noDevices: 'Aucun appareil connecté.', devOut: 'Appareil déconnecté.',
  supportT: 'Demandes d’assistance', newTicket: 'Nouvelle demande', subject: 'Sujet', message: 'Message', send: 'Envoyer', reply: 'Répondre', writeReply: 'Écrire une réponse…',
  ticket_short: 'Écrivez un sujet et un message plus long.', ticket_limit: 'Vous pouvez ouvrir 3 demandes par jour. Répondez dans une demande existante.', ticket_full: 'Cette demande est pleine. Ouvrez-en une nouvelle.',
  noTickets: 'Aucune demande. Dites-nous comment vous aider.', st_open: 'En attente de notre réponse', st_answered: 'Répondu', st_closed: 'Fermée', ticketSent: 'Envoyé. Nous répondons ici.', you: 'Vous', supportTeam: 'Assistance',
  paymentsT: 'Paiements', noPayments: 'Aucun paiement.', receipt: 'Reçu', print: 'Imprimer', receiptFor: 'Reçu pour', paidOn: 'Payé le', amount: 'Montant', item: 'Article', reference: 'Référence',
  continueW: 'Reprendre la lecture', recentCh: 'Vus récemment', clearHist: 'Effacer l’historique', histCleared: 'Historique effacé.', resumed: 'Reprise à {t}',
  parentalT: 'Contrôle parental', parentalText: 'Masquer les catégories pour adultes sur cet appareil jusqu’à la saisie du code PIN.', pin: 'Code PIN à 4 chiffres', setPin: 'Activer', pinOnText: 'Les catégories pour adultes sont masquées sur cet appareil.', removePin: 'Désactiver', enterPin: 'Saisissez le code PIN', wrongPin: 'Code PIN incorrect.', pinNeeds: 'Le code PIN doit avoir 4 chiffres.', unlock: 'Déverrouiller', locked: '🔒 Verrouillé', pinSaved: 'Contrôle parental activé.', pinRemoved: 'Contrôle parental désactivé.',
  libraryT: 'Ma bibliothèque', loadingDots: 'Chargement…',
});


// ---- dashboard home, own playlists, requests ----
Object.assign(D.en, {
  overview: 'Here is your account overview.', activePlan: 'Active plan', expiresOn: 'Expires on', connectedDev: 'Connected devices', quick: 'Quick actions', managePlan: 'Manage plan', contactSup: 'Contact support',
  srcT: 'My playlists', srcText: 'Add your own IPTV provider with Xtream Codes or an M3U playlist. The details are saved on this device only.', srcMain: '{app} subscription', srcActive: 'In use', srcUse: 'Use', srcRemove: 'Remove',
  srcName: 'Name', srcServer: 'Server address', srcUrl: 'Playlist address', srcFile: 'Or choose a playlist file', srcCheckAdd: 'Check and add', srcTesting: 'Checking…', srcSaved: 'Added: {n}', srcChannels: '{n} items',
  srcBadUrl: 'Enter an address that starts with http:// or https://', srcBadLogin: 'The provider refused this username or password.', srcExpired: 'This account is not active at the provider.', srcUnreachable: 'The provider could not be reached. Check the address and try again.', srcEmpty: 'No channels were found in this playlist.',
  srcNeedApp: 'This playlist cannot be opened in the browser. Use the Android, TV or desktop app.', srcNow: 'Now watching: {name}', srcBack: 'Back to {app}', srcOnlyYours: 'Only add providers you have the right to use.',
  refundAsk: 'Ask for a refund', refundSubj: 'Refund request', delAsk: 'Ask to delete my account', delSubj: 'Please delete my account', delText: 'I would like my account and my data to be deleted.',
});
Object.assign(D.fr, {
  overview: 'Voici l’aperçu de votre compte.', activePlan: 'Offre active', expiresOn: 'Expire le', connectedDev: 'Appareils connectés', quick: 'Actions rapides', managePlan: 'Gérer l’offre', contactSup: 'Contacter l’assistance',
  srcT: 'Mes playlists', srcText: 'Ajoutez votre propre fournisseur IPTV avec Xtream Codes ou une playlist M3U. Les informations restent sur cet appareil.', srcMain: 'Abonnement {app}', srcActive: 'Utilisée', srcUse: 'Utiliser', srcRemove: 'Supprimer',
  srcName: 'Nom', srcServer: 'Adresse du serveur', srcUrl: 'Adresse de la playlist', srcFile: 'Ou choisissez un fichier playlist', srcCheckAdd: 'Vérifier et ajouter', srcTesting: 'Vérification…', srcSaved: 'Ajoutée : {n}', srcChannels: '{n} éléments',
  srcBadUrl: 'Saisissez une adresse commençant par http:// ou https://', srcBadLogin: 'Le fournisseur a refusé ce nom d’utilisateur ou ce mot de passe.', srcExpired: 'Ce compte n’est pas actif chez le fournisseur.', srcUnreachable: 'Fournisseur injoignable. Vérifiez l’adresse et réessayez.', srcEmpty: 'Aucune chaîne trouvée dans cette playlist.',
  srcNeedApp: 'Cette playlist ne peut pas s’ouvrir dans le navigateur. Utilisez l’application Android, TV ou ordinateur.', srcNow: 'En cours : {name}', srcBack: 'Revenir à {app}', srcOnlyYours: 'N’ajoutez que des fournisseurs que vous avez le droit d’utiliser.',
  refundAsk: 'Demander un remboursement', refundSubj: 'Demande de remboursement', delAsk: 'Demander la suppression de mon compte', delSubj: 'Merci de supprimer mon compte', delText: 'Je souhaite que mon compte et mes données soient supprimés.',
});


// ---- customer two-step sign-in, email check, attachments, TV guide ----
Object.assign(D.en, { tfaT: 'Two-step sign-in', tfaText: 'Adds a 6-digit code from an authenticator app on top of your password.', tfaOnText: 'On. Signing in needs your password and a code from your authenticator app.', turnOn: 'Turn on', turnOff: 'Turn off', tfaOn: 'Two-step sign-in is on', tfaOff: 'Two-step sign-in is off',
  tfaStep1: 'Open an authenticator app (Google Authenticator, Authy…) and add an account.', tfaStep2: 'On this phone, tap the link. On another device, type this key:', tfaAdd: 'Add to my authenticator app', tfaStep3: 'Enter the 6-digit code the app shows.', tfaKeep: 'Keep the key somewhere safe. If you lose your phone, contact support to turn this off.',
  tfa_already: 'Two-step sign-in is already on.', tfa_start: 'Start the setup first.', tfa_wrong: 'That code is not right. Try the newest code.' });
Object.assign(D.fr, { tfaT: 'Connexion en deux étapes', tfaText: 'Ajoute un code à 6 chiffres d’une application d’authentification en plus de votre mot de passe.', tfaOnText: 'Activée. La connexion demande votre mot de passe et un code de votre application d’authentification.', turnOn: 'Activer', turnOff: 'Désactiver', tfaOn: 'Connexion en deux étapes activée', tfaOff: 'Connexion en deux étapes désactivée',
  tfaStep1: 'Ouvrez une application d’authentification (Google Authenticator, Authy…) et ajoutez un compte.', tfaStep2: 'Sur ce téléphone, touchez le lien. Sur un autre appareil, saisissez cette clé :', tfaAdd: 'Ajouter à mon application d’authentification', tfaStep3: 'Saisissez le code à 6 chiffres affiché.', tfaKeep: 'Gardez la clé en lieu sûr. Si vous perdez votre téléphone, contactez l’assistance pour désactiver.',
  tfa_already: 'La connexion en deux étapes est déjà activée.', tfa_start: 'Commencez d’abord la configuration.', tfa_wrong: 'Ce code est incorrect. Essayez le code le plus récent.' });


Object.assign(D.en, { emVerify: 'Verify email', emVerified: 'Verified', emSent: 'We sent a 6-digit code to {email}. Enter it here.', em_none: 'There is no email address on this account.', em_limit: 'You asked for 3 codes today. Please try again tomorrow.', em_fail: 'The email could not be sent. Please try again later.', em_expired: 'This code has expired. Ask for a new one.', em_wrong: 'That code is not right.' });
Object.assign(D.fr, { emVerify: 'Vérifier l’e-mail', emVerified: 'Vérifié', emSent: 'Nous avons envoyé un code à 6 chiffres à {email}. Saisissez-le ici.', em_none: 'Aucune adresse e-mail sur ce compte.', em_limit: 'Vous avez demandé 3 codes aujourd’hui. Réessayez demain.', em_fail: 'L’e-mail n’a pas pu être envoyé. Réessayez plus tard.', em_expired: 'Ce code a expiré. Demandez-en un nouveau.', em_wrong: 'Ce code est incorrect.' });


Object.assign(D.en, { attAdd: 'Add a picture (optional)', attShow: 'Show picture', att_bad: 'This picture could not be used. Choose a smaller photo or a screenshot.', att_gone: 'This picture is no longer stored.' });
Object.assign(D.fr, { attAdd: 'Ajouter une image (facultatif)', attShow: 'Afficher l’image', att_bad: 'Cette image ne peut pas être utilisée. Choisissez une photo plus petite ou une capture d’écran.', att_gone: 'Cette image n’est plus enregistrée.' });


Object.assign(D.en, { channelsV: 'Channels', noGuide: 'No programme information' });
Object.assign(D.fr, { channelsV: 'Chaînes', noGuide: 'Pas d’information sur les programmes' });


Object.assign(D.en, { trial_typo: 'Please check your email address. Did you mean {s}?', trial_bademail: 'This email address cannot receive mail. Please check it.', useIt: 'Use it' });
Object.assign(D.fr, { trial_typo: 'Vérifiez votre adresse e-mail. Vouliez-vous dire {s} ?', trial_bademail: 'Cette adresse e-mail ne peut pas recevoir de messages. Vérifiez-la.', useIt: 'Utiliser' });


Object.assign(D.en, { countryCode: 'Country code', trial_phone: 'Choose your country code and enter your full phone number.', trial_panel: 'Your request is saved, but the trial could not start yet. Please contact support.', trialPending: 'Your request is received ✅ Your account is ready and we are preparing your TV line now. You will get an email as soon as it is active. Keep these details:', copy: 'Copy', copied: 'Copied ✓', pendingTitle: 'Your line is being prepared', pendingText: 'We received your request. You will get an email as soon as your TV line is active. It usually does not take long.' });
Object.assign(D.fr, { countryCode: 'Indicatif du pays', trial_phone: 'Choisissez l’indicatif de votre pays et saisissez votre numéro complet.', trial_panel: 'Votre demande est enregistrée, mais l’essai n’a pas encore pu démarrer. Contactez l’assistance.', trialPending: 'Votre demande est reçue ✅ Votre compte est prêt et nous préparons votre ligne TV. Vous recevrez un e-mail dès qu’elle sera active. Gardez ces informations :', copy: 'Copier', copied: 'Copié ✓', pendingTitle: 'Votre ligne est en préparation', pendingText: 'Nous avons bien reçu votre demande. Vous recevrez un e-mail dès que votre ligne TV sera active.' });


Object.assign(D.en, { chatT: 'Chat with support', chatPh: 'Write a message…', chatEmpty: 'Write to us here. We answer in this chat.', chat_empty: 'Write a message first.', chat_slow: 'You are writing very fast. Please wait a few minutes.' });
Object.assign(D.fr, { chatT: 'Discuter avec l’assistance', chatPh: 'Écrire un message…', chatEmpty: 'Écrivez-nous ici. Nous répondons dans cette discussion.', chat_empty: 'Écrivez d’abord un message.', chat_slow: 'Vous écrivez très vite. Patientez quelques minutes.' });


Object.assign(D.en, { lineBadTitle: 'Your TV line is not active', lineBadText: 'The server does not recognise your line right now. Write to us and we will fix it quickly.', rcBtn: 'I have paid: send my receipt', rcTitle: 'Send a payment receipt', rcPkg: 'Package you paid for', rcFile: 'Photo or screenshot of the receipt', rcNote: 'Note (optional)', rcSent: 'Receipt sent ✓ We check it and activate your subscription. You will be told in the chat and by email.', rc_pkg: 'Choose the package you paid for.', rc_image: 'Add a photo of the receipt.', rc_limit: 'You sent 3 receipts today. Please write to us in the chat.', rc_pending: 'Being checked', rc_approved: 'Approved', rc_rejected: 'Not accepted' });
Object.assign(D.fr, { lineBadTitle: 'Votre ligne TV n’est pas active', lineBadText: 'Le serveur ne reconnaît pas votre ligne pour le moment. Écrivez-nous et nous corrigeons cela rapidement.', rcBtn: 'J’ai payé : envoyer mon reçu', rcTitle: 'Envoyer un reçu de paiement', rcPkg: 'Offre payée', rcFile: 'Photo ou capture du reçu', rcNote: 'Note (facultatif)', rcSent: 'Reçu envoyé ✓ Nous le vérifions et activons votre abonnement. Vous serez informé dans la discussion et par e-mail.', rc_pkg: 'Choisissez l’offre payée.', rc_image: 'Ajoutez une photo du reçu.', rc_limit: 'Vous avez envoyé 3 reçus aujourd’hui. Écrivez-nous dans la discussion.', rc_pending: 'En vérification', rc_approved: 'Approuvé', rc_rejected: 'Non accepté' });


Object.assign(D.en, { srvCode: 'The TV server did not accept this request (code {n}). Please try again in a moment.' });
Object.assign(D.fr, { srvCode: 'Le serveur TV n’a pas accepté cette demande (code {n}). Réessayez dans un instant.' });


Object.assign(D.en, { paidTitle: 'Thank you for your payment', paidText: 'Your subscription is being activated. It usually updates within a minute; if not, send us your receipt and we activate it by hand.', paidBackTitle: 'Did you finish paying?', paidBackText: 'If you paid, your subscription updates shortly. If it does not, send us your receipt here.' });
Object.assign(D.fr, { paidTitle: 'Merci pour votre paiement', paidText: 'Votre abonnement est en cours d’activation. La mise à jour prend généralement moins d’une minute ; sinon, envoyez-nous votre reçu et nous l’activons manuellement.', paidBackTitle: 'Avez-vous terminé le paiement ?', paidBackText: 'Si vous avez payé, votre abonnement se met à jour sous peu. Sinon, envoyez-nous votre reçu ici.' });

export const LANGS = [['en', 'English'], ['fr', 'Français']];
export function detectLang() {
  const saved = localStorage.getItem('tvp_lang');
  if (saved && D[saved]) return saved;
  for (const l of navigator.languages || [navigator.language || 'en']) {
    const k = String(l).slice(0, 2).toLowerCase();
    if (D[k]) return k;
  }
  return 'en';
}
let lang = 'en';
export function setLang(l, save) {
  lang = D[l] ? l : 'en';
  if (save) localStorage.setItem('tvp_lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = 'ltr';
}
export const getLang = () => lang;
export const locale = () => (lang === 'fr' ? 'fr-FR' : 'en-GB');
export function t(key, vars = {}) {
  const s = (D[lang] && D[lang][key]) ?? D.en[key] ?? key;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
// Map English server messages to the current language
export function tErr(msg) {
  const map = { 'Wrong username or password.': 'wrongLogin', 'This account is disabled. Please contact support.': 'disabled' };
  if (D.en[msg]) return t(msg);
  return map[msg] ? t(map[msg]) : msg;
}
Object.assign(D.en, { trialQueued: 'Your request is received ✅ An agent will process your trial and email you your login shortly.', trialQueuedSub: 'We sent a confirmation to {email}. If you do not hear from us within a few minutes, contact support.' });
Object.assign(D.fr, { trialQueued: 'Votre demande est reçue ✅ Un agent traitera votre essai et vous enverra vos identifiants par e-mail.', trialQueuedSub: 'Nous avons envoyé une confirmation à {email}. Sans nouvelles dans quelques minutes, contactez l’assistance.' });
Object.assign(D.en, { linesN: 'Lines (devices)', totalPaid: 'Total paid' });
Object.assign(D.fr, { linesN: 'Lignes (appareils)', totalPaid: 'Total payé' });
Object.assign(D.en, { captcha_bad: 'Wrong answer to the check question. Try again.', captchaQ: 'What is {q}?' });
Object.assign(D.fr, { captcha_bad: 'Mauvaise réponse à la question. Réessayez.', captchaQ: 'Que vaut {q} ?' });
// Extra keys for the /freetrial and /resellers pages and the service-details card (customer side).
Object.assign(D.en, { telegramId: 'Telegram ID (optional)', optional: 'Optional — used if we need to reach you on Telegram.', resellerPanel: 'Reseller panel', resellerIntro: 'Buy credits in bulk, activate IBO Player and TVPlus accounts and keep every purchase in one place. Sign in with the account we created for you.', resellerSignIn: 'Sign in to your reseller account', resellerProgram: 'Not a reseller yet? Contact us to open a reseller account.', serviceDetails: 'Service details', creditBalance: 'Credit balance', purchaseHistory: 'Purchase history', noPurchases: 'No purchases yet.', copyDetails: '📋 Copy details', yourLogin: 'Your login', m3uOne: 'M3U link', backHome: 'Back to home' });
Object.assign(D.fr, { telegramId: 'Identifiant Telegram (facultatif)', optional: 'Facultatif — pour vous joindre sur Telegram si besoin.', resellerPanel: 'Espace revendeur', resellerIntro: 'Achetez des crédits en gros, activez des comptes IBO Player et TVPlus et retrouvez tous vos achats au même endroit. Connectez-vous avec le compte que nous avons créé pour vous.', resellerSignIn: 'Se connecter à mon espace revendeur', resellerProgram: 'Pas encore revendeur ? Contactez-nous pour ouvrir un compte revendeur.', serviceDetails: 'Informations du service', creditBalance: 'Solde de crédits', purchaseHistory: 'Historique des achats', noPurchases: 'Aucun achat pour le moment.', copyDetails: '📋 Copier', yourLogin: 'Vos identifiants', m3uOne: 'Lien M3U', backHome: "Retour à l'accueil" });

// How-to activation guide (customer account)
Object.assign(D.en, { userGuide: 'How to activate (IBO Player)', gStep1: 'Install IBO Player (or IBO Player Pro / IPTV Smarters) from the app store on your Smart TV, Android TV or phone.', gStep2: 'Open the app and note your Device ID (MAC address) and Device Key, then enter them on the activation page (or send them to support) to activate the app.', gStep3: 'In My Playlists above, copy Username, Password and DNS — in the app choose Add Xtream Playlist and paste them, or paste the M3U link directly as the playlist URL.', gStep4: 'Reload / Restart the app — your channels, movies and series load automatically.' });
Object.assign(D.fr, { userGuide: 'Comment activer (IBO Player)', gStep1: 'Installez IBO Player (ou IBO Player Pro / IPTV Smarters) depuis le store de votre TV, Android TV ou téléphone.', gStep2: 'Ouvrez l’application et notez Device ID (adresse MAC) et Device Key, puis entrez-les sur la page d’activation (ou envoyez-les au support) pour activer l’app.', gStep3: 'Dans « Mes playlists » ci-dessus, copiez Username, Password et DNS — dans l’app, choisissez Add Xtream Playlist et collez-les, ou collez le lien M3U comme URL de playlist.', gStep4: 'Rechargez ou redémarrez l’app — vos chaînes, films et séries se chargent automatiquement.' });
