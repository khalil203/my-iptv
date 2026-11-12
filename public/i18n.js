// Customer-side languages: English, French, Arabic. Picked automatically from the phone language.
const D = {
  en: {
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
  ar: {
    welcome: 'مرحبًا بعودتك', loginSub: 'سجّل الدخول بالمعلومات التي وصلتك.', tagline: 'بث مباشر · أفلام · مسلسلات',
    username: 'اسم المستخدم', password: 'كلمة المرور', signIn: 'تسجيل الدخول', language: 'اللغة',
    startTrial: 'ابدأ تجربتك المجانية {hours} ساعة', trialTitle: 'تجربة مجانية لمدة {hours} ساعة', trialIntro: 'أدخل معلوماتك وسنرسل بيانات الدخول إلى بريدك الإلكتروني.',
    fullName: 'الاسم الكامل', email: 'البريد الإلكتروني', phone: 'رقم الهاتف', whatsapp: 'رقم واتساب', sameWhatsapp: 'رقم واتساب هو نفس رقم الهاتف',
    getTrial: 'احصل على تجربتي المجانية', cancel: 'إلغاء', trialSent: 'تم! 🎉 تفقد بريدك ({email}) لتجد بيانات الدخول. تحقق أيضًا من مجلد الرسائل غير المرغوب فيها.',
    trialShown: 'تجربتك المجانية جاهزة 🎉 احفظ هذه المعلومات:', haveAccount: 'العودة لتسجيل الدخول',
    trial_used: 'تم استخدام التجربة المجانية مسبقًا بهذا البريد أو الرقم.', trial_invalid: 'يرجى إدخال الاسم وبريد إلكتروني ورقم هاتف صحيحين.',
    trial_ip: 'محاولات كثيرة من هذه الشبكة اليوم. حاول غدًا.', trial_off: 'التجربة المجانية غير متاحة حاليًا.', trial_panel: 'تعذّر إنشاء تجربتك الآن. يرجى التواصل مع الدعم.',
    wrongLogin: 'اسم المستخدم أو كلمة المرور غير صحيحة.', disabled: 'هذا الحساب معطّل. يرجى التواصل مع الدعم.',
    home: 'الرئيسية', live: 'مباشر', movies: 'أفلام', series: 'مسلسلات', account: 'حسابي', liveTv: 'البث المباشر', support: 'تواصل مع الدعم',
    hello: 'مرحبًا، {name} 👋', mySub: 'اشتراكي', daysLeft: 'يوم متبقٍ', hoursLeft: 'ساعة متبقية', until: 'حتى {date}', devices: '{n} جهاز',
    st_active: 'نشط', st_expiring: 'ينتهي قريبًا', st_expired: 'منتهي', st_disabled: 'معطّل', trial: 'تجربة مجانية',
    expiringSoon: 'ينتهي اشتراكك خلال {n} يوم.', trialEnds: 'تنتهي تجربتك المجانية خلال {n} ساعة.', renewNow: 'جدّد الآن', contactRenew: 'تواصل معنا للتجديد.',
    expiredOn: 'انتهى اشتراكك في {date}.', expiredTitle: 'انتهى اشتراكك', expiredText: 'انتهى في {date}. جدّد اشتراكك لمواصلة المشاهدة.',
    maintTitle: 'تحت الصيانة', notReady: 'غير متاح بعد', notReadyText: 'خادم البث غير مُعدّ بعد. يرجى التواصل مع الدعم.',
    favorites: '⭐ المفضلة', search: '🔎 ابحث في هذا القسم…', all: 'الكل', nothing: 'لا توجد نتائج.', more: 'عرض المزيد ({n})',
    play: '▶ تشغيل', tvGuide: 'دليل البرامج', season: 'الموسم {n}', noEps: 'لا توجد حلقات بعد.', streamFail: '⚠️ تعذّر تشغيل هذا البث. جرّب قناة أخرى أو تواصل مع الدعم.',
    status: 'الحالة', plan: 'الباقة', started: 'البداية', expires: 'ينتهي في', devicesL: 'الأجهزة', history: 'السجل', startedOn: 'بدأ', renewed: 'تجديد',
    changePw: 'تغيير كلمة المرور', currentPw: 'كلمة المرور الحالية', newPw: 'كلمة المرور الجديدة', updatePw: 'تحديث كلمة المرور', pwUpdated: 'تم تحديث كلمة المرور ✓',
    logout: 'تسجيل الخروج', getApp: 'حمّل التطبيق', notAvailable: 'التشغيل غير متاح حاليًا.', demo: 'وضع تجريبي · البيانات في هذا المتصفح فقط',
  },
};

export const LANGS = [['en', 'English'], ['fr', 'Français'], ['ar', 'العربية']];
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
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
export const getLang = () => lang;
export const locale = () => (lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-FR' : 'en-GB');
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
