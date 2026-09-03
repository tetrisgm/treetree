/** The archive speaks three languages, because the family does: the
 * dedication in the 2013 archive was printed in English, Persian and French.
 * Only the chrome is translated - names, biographies and stories stay in the
 * language they were written in. */
export const LANGUAGES = ["en", "fa", "fr"] as const;
export type Lang = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", fa: "فارسی", fr: "Français" };
/** A flag stands for the language here, not a nationality - the family is
 * spread across all three. */
export const LANGUAGE_FLAGS: Record<Lang, string> = { en: "🇬🇧", fa: "🇮🇷", fr: "🇫🇷" };
export const isRtl = (lang: Lang) => lang === "fa";
export const LANG_COOKIE = "archive_lang";

type Dict = Record<string, string>;

const en: Dict = {
  "view.family": "Family", "view.tree": "Tree", "view.list": "List", "view.timeline": "Timeline",
  "view.calendar": "Calendar", "view.map": "Map", "view.stats": "Numbers", "view.fill": "Fill in",
  "nav.search": "Find a person…", "nav.signIn": "Sign in", "nav.settings": "Settings", "nav.signOut": "Sign out",
  "nav.view": "Archive view", "nav.account": "Account menu",

  "chat.welcome": "Welcome{name}. Ask about the family, add what you know, or attach documents and photos — I’ll keep the tree up to date.",
  "archive.name": "{archive}",
  "chat.genesis": "Welcome{name}. This archive is empty — let’s begin it together. Tell me who you are and I’ll start the record, then we’ll work outward: your parents, their parents, everyone they remember. A GEDCOM export from another service can also seed the whole tree in one step.",
  "chat.genesisMe": "Start with me: my name is …",
  "chat.genesisParents": "My parents are … and …",
  "chat.genesisImport": "I have a GEDCOM export from another service.",
  "chat.placeholder": "Ask a question, add what you know, or just chat…",
  "chat.placeholderPerson": "Ask about {name}, or add what you know…",
  "chat.viewerPlaceholder": "Who are the children of…?",
  "chat.viewerPlaceholderPerson": "Ask about {name}…",
  "chat.fromArchive": "From the archive",
  "chat.thinking": "Thinking…",
  "chat.send": "Send message",
  "chat.attach": "Add files or a folder", "chat.addFiles": "Add files", "chat.sendDocuments": "Send documents to read", "chat.addFolder": "Add a folder",
  "chat.collapse": "Collapse family chat", "chat.reveal": "Show family chat",
  "chat.title": "The {archive} family tree",
  "chat.intro": "Explore our family history, ask about the people and relationships in the tree, and discover the stories recorded here.",
  "chat.focusEditor": "Questions and details you type go to {name}’s record.",
  "chat.focusViewer": "Answers here are about {name}.",
  "chat.clearFocus": "Stop writing to {name}’s record",

  "family.hint": "Click a person to center the tree on them and open their record.",
  "family.children": "Children",
  "family.grandchildren": "Grandchildren",
  "family.parents": "Parents",
  "family.grandparents": "Grandparents",
  "family.greatGrandparents": "Great-grandparents",
  "family.moreRelatives": "{n} more relatives - click to see them", "family.siblings": "Siblings",
  "family.addFather": "Add father",
  "family.addMother": "Add mother",
  "family.addGrandfather": "Add grandfather",
  "family.addGrandmother": "Add grandmother",
  "family.none": "none recorded",
  "family.back": "Back",
  "family.forward": "Forward",
  "person.born": "Born", "person.died": "Died", "person.death": "Death", "person.living": "Living",
  "person.stillLiving": "Still living", "person.recordDeath": "Record a death",
  "person.buried": "Buried", "person.burialPlaceholder": "cemetery or resting place",
  "person.lives": "Lives in", "person.residencePlaceholder": "add a city or country",
  "person.clearDeath": "Remove the death and show them as living",
  "person.notRecorded": "Not recorded", "person.birthNotRecorded": "Birth date not recorded",
  "person.biography": "Biography", "person.addBiography": "Add a biography…",
  "person.photographs": "Photographs", "person.addPhoto": "Add photo", "person.portrait": "Portrait",
  "person.whoElse": "Who else?", "person.removePhoto": "Remove", "person.whoElsePrompt": "Who else is in this photograph?",
  "person.parents": "Parents", "person.spouse": "Spouse", "person.children": "Children", "person.siblings": "Siblings",
  "person.stories": "Stories", "person.readOriginal": "Read the original Persian", "person.fromArchive": "From the family archive",
  "person.notes": "Notes from the family", "person.notePlaceholder": "Add what you remember, or a correction…",
  "person.postNote": "Post note", "person.deleteNote": "Delete this note",
  "person.delete": "Delete person", "person.removePortrait": "Remove portrait",
  "person.close": "Close", "person.previous": "Previous person", "person.next": "Next person",
  "person.addName": "Name", "person.addDate": "add date", "person.city": "city", "person.country": "country",
  "person.maidenName": "add maiden name", "person.nee": "née",
  "person.female": "♀ Female", "person.male": "♂ Male",
  "person.done": "Done", "person.save": "Save", "person.cancel": "Cancel",

  "fill.questionsTitle": "Questions for the family",
  "fill.questionsIntro": "The old records imply these but never say them outright. Confirming applies the change; every answer is recorded.",
  "fill.confirm": "Confirm", "fill.deny": "Not correct", "fill.recordName": "Record the name", "fill.notKnown": "Not known",
  "fill.notePlaceholder": "Add a note (optional)", "fill.namePlaceholder": "Her name…",
  "fill.search": "Find a person to fill in…", "fill.allGenerations": "All generations",
  "fill.progress": "{complete} of {total} records are complete · {gaps} with gaps",

  "map.title": "Where the family has lived", "map.zoomIn": "Zoom in", "map.zoomOut": "Zoom out", "map.reset": "Reset zoom",
  "place.people": "{count} people in the records", "place.onePerson": "One person in the records",
  "place.bornHere": "Born here", "place.diedHere": "Died here", "place.bornDiedHere": "Born and died here",

  "calendar.title": "The family year",
  "calendar.intro": "Birthdays of the living, the days we remember, and the anniversaries of the stories. Only full dates appear here — a year alone has no day to fall on.",
  "calendar.today": "Today",
  "stats.title": "The shape of the family", "stats.intro": "Everything here is counted from the records as they stand today.",
  "timeline.title": "Lives and stories through time",

  "settings.title": "Settings", "settings.back": "← Back to the family tree",
  "settings.language": "Language", "settings.languageHint": "The archive's own words — names, biographies and stories — stay in the language they were written in.",
};

const fa: Dict = {
  "view.family": "خانواده", "view.tree": "شجره‌نامه", "view.list": "فهرست", "view.timeline": "گاه‌شمار",
  "view.calendar": "تقویم", "view.map": "نقشه", "view.stats": "آمار", "view.fill": "تکمیل",
  "nav.search": "جست‌وجوی نام…", "nav.signIn": "ورود", "nav.settings": "تنظیمات", "nav.signOut": "خروج",
  "nav.view": "نمای آرشیو", "nav.account": "منوی حساب",

  "chat.welcome": "خوش آمدید{name}. درباره‌ی خانواده بپرسید، آنچه می‌دانید بیفزایید، یا سند و عکس پیوست کنید — من شجره‌نامه را به‌روز نگه می‌دارم.",
  "archive.name": "{archive}",
  "chat.genesis": "خوش آمدید{name}. این بایگانی خالی است — بیایید با هم آغازش کنیم. بگویید کیستید تا ثبت را شروع کنم، سپس قدم‌به‌قدم پیش می‌رویم: پدر و مادرتان، پدربزرگ‌ها و مادربزرگ‌ها، و هر که را به یاد دارند. یک خروجی GEDCOM از سرویسی دیگر هم می‌تواند کل شجره را یک‌جا بنشاند.",
  "chat.genesisMe": "با من شروع کن: نام من … است",
  "chat.genesisParents": "پدر و مادر من … و … هستند",
  "chat.genesisImport": "یک خروجی GEDCOM از سرویس دیگری دارم.",
  "chat.placeholder": "بپرسید، آنچه می‌دانید بنویسید، یا گفت‌وگو کنید…",
  "chat.placeholderPerson": "درباره‌ی {name} بپرسید یا آنچه می‌دانید بیفزایید…",
  "chat.viewerPlaceholder": "فرزندان چه کسی…؟",
  "chat.viewerPlaceholderPerson": "درباره‌ی {name} بپرسید…",
  "chat.fromArchive": "از آرشیو",
  "chat.thinking": "در حال فکر کردن…",
  "chat.send": "ارسال پیام",
  "chat.attach": "افزودن پرونده یا پوشه", "chat.addFiles": "افزودن پرونده", "chat.sendDocuments": "ارسال سند برای خواندن", "chat.addFolder": "افزودن پوشه",
  "chat.collapse": "بستن گفت‌وگو", "chat.reveal": "نمایش گفت‌وگو",
  "chat.title": "شجره‌نامه‌ی خاندان {archive}",
  "chat.intro": "تاریخ خانواده را کاوش کنید، درباره‌ی افراد و نسبت‌ها بپرسید، و داستان‌های ثبت‌شده را بخوانید.",
  "chat.focusEditor": "هر پرسش یا نکته‌ای که بنویسید به پرونده‌ی {name} می‌رود.",
  "chat.focusViewer": "پاسخ‌ها درباره‌ی {name} است.",
  "chat.clearFocus": "پایان نوشتن در پرونده‌ی {name}",

  "family.hint": "روی هر نام کلیک کنید تا در مرکز قرار گیرد و پرونده‌اش باز شود.",
  "family.children": "فرزندان",
  "family.grandchildren": "نوه‌ها",
  "family.parents": "والدین",
  "family.grandparents": "پدربزرگ و مادربزرگ",
  "family.greatGrandparents": "نیاکان",
  "family.moreRelatives": "{n} خویشاوند دیگر - برای دیدن کلیک کنید", "family.siblings": "خواهر و برادر",
  "family.addFather": "افزودن پدر",
  "family.addMother": "افزودن مادر",
  "family.addGrandfather": "افزودن پدربزرگ",
  "family.addGrandmother": "افزودن مادربزرگ",
  "family.none": "ثبت نشده",
  "family.back": "پیشین",
  "family.forward": "بعدی",
  "person.born": "تولد", "person.died": "درگذشت", "person.death": "درگذشت", "person.living": "در قید حیات",
  "person.stillLiving": "در قید حیات", "person.recordDeath": "ثبت درگذشت",
  "person.buried": "محل دفن", "person.burialPlaceholder": "آرامگاه یا گورستان",
  "person.lives": "محل زندگی", "person.residencePlaceholder": "شهر یا کشور را بنویسید",
  "person.clearDeath": "حذف درگذشت و نمایش در قید حیات",
  "person.notRecorded": "ثبت نشده", "person.birthNotRecorded": "تاریخ تولد ثبت نشده",
  "person.biography": "زندگی‌نامه", "person.addBiography": "افزودن زندگی‌نامه…",
  "person.photographs": "عکس‌ها", "person.addPhoto": "افزودن عکس", "person.portrait": "عکس اصلی",
  "person.whoElse": "چه کسان دیگری؟", "person.removePhoto": "حذف", "person.whoElsePrompt": "چه کسان دیگری در این عکس هستند؟",
  "person.parents": "والدین", "person.spouse": "همسر", "person.children": "فرزندان", "person.siblings": "خواهر و برادر",
  "person.stories": "داستان‌ها", "person.readOriginal": "خواندن متن اصلی فارسی", "person.fromArchive": "از آرشیو خانوادگی",
  "person.notes": "یادداشت‌های خانواده", "person.notePlaceholder": "آنچه به یاد دارید یا اصلاحی بنویسید…",
  "person.postNote": "ثبت یادداشت", "person.deleteNote": "حذف این یادداشت",
  "person.delete": "حذف این شخص", "person.removePortrait": "حذف عکس اصلی",
  "person.close": "بستن", "person.previous": "شخص پیشین", "person.next": "شخص بعدی",
  "person.addName": "نام", "person.addDate": "افزودن تاریخ", "person.city": "شهر", "person.country": "کشور",
  "person.maidenName": "افزودن نام خانوادگی پدری", "person.nee": "زادهٔ",
  "person.female": "♀ زن", "person.male": "♂ مرد",
  "person.done": "پایان", "person.save": "ذخیره", "person.cancel": "انصراف",

  "fill.questionsTitle": "پرسش‌هایی از خانواده",
  "fill.questionsIntro": "اسناد قدیمی این‌ها را می‌رسانند اما صریح نمی‌گویند. تأیید، تغییر را اعمال می‌کند و هر پاسخ ثبت می‌شود.",
  "fill.confirm": "تأیید", "fill.deny": "درست نیست", "fill.recordName": "ثبت نام", "fill.notKnown": "نمی‌دانم",
  "fill.notePlaceholder": "یادداشت (اختیاری)", "fill.namePlaceholder": "نام او…",
  "fill.search": "جست‌وجوی نام برای تکمیل…", "fill.allGenerations": "همه‌ی نسل‌ها",
  "fill.progress": "{complete} از {total} پرونده کامل است · {gaps} ناقص",

  "map.title": "جاهایی که خانواده زیسته است", "map.zoomIn": "بزرگ‌نمایی", "map.zoomOut": "کوچک‌نمایی", "map.reset": "بازنشانی",
  "place.people": "{count} نفر در اسناد", "place.onePerson": "یک نفر در اسناد",
  "place.bornHere": "زادهٔ اینجا", "place.diedHere": "درگذشتهٔ اینجا", "place.bornDiedHere": "زاده و درگذشتهٔ اینجا",

  "calendar.title": "سال خانواده",
  "calendar.intro": "زادروز زندگان، روزهای یادبود، و سالگرد داستان‌ها. تنها تاریخ‌های کامل اینجا می‌آیند — سالِ تنها روزی برای افتادن ندارد.",
  "calendar.today": "امروز",
  "stats.title": "شکل خانواده", "stats.intro": "همه‌ی این ارقام از اسناد امروز شمرده شده است.",
  "timeline.title": "زندگی‌ها و داستان‌ها در گذر زمان",

  "settings.title": "تنظیمات", "settings.back": "→ بازگشت به شجره‌نامه",
  "settings.language": "زبان", "settings.languageHint": "متن‌های خود آرشیو — نام‌ها، زندگی‌نامه‌ها و داستان‌ها — به همان زبانی می‌مانند که نوشته شده‌اند.",
};

const fr: Dict = {
  "view.family": "Famille", "view.tree": "Arbre", "view.list": "Liste", "view.timeline": "Chronologie",
  "view.calendar": "Calendrier", "view.map": "Carte", "view.stats": "Chiffres", "view.fill": "Compléter",
  "nav.search": "Rechercher une personne…", "nav.signIn": "Se connecter", "nav.settings": "Réglages", "nav.signOut": "Se déconnecter",
  "nav.view": "Vue des archives", "nav.account": "Menu du compte",

  "chat.welcome": "Bienvenue{name}. Posez vos questions sur la famille, ajoutez ce que vous savez, ou joignez des documents et des photos — je tiens l’arbre à jour.",
  "archive.name": "{archive}",
  "chat.genesis": "Bienvenue{name}. Ces archives sont vides — commençons-les ensemble. Dites-moi qui vous êtes et j’ouvrirai le registre, puis nous avancerons : vos parents, leurs parents, tous ceux dont on se souvient. Un export GEDCOM d’un autre service peut aussi amorcer l’arbre entier d’un coup.",
  "chat.genesisMe": "Commençons par moi : je m’appelle …",
  "chat.genesisParents": "Mes parents sont … et …",
  "chat.genesisImport": "J’ai un export GEDCOM d’un autre service.",
  "chat.placeholder": "Posez une question, ajoutez ce que vous savez, ou discutez…",
  "chat.placeholderPerson": "Posez une question sur {name}, ou ajoutez ce que vous savez…",
  "chat.viewerPlaceholder": "Qui sont les enfants de… ?",
  "chat.viewerPlaceholderPerson": "Une question sur {name} ?",
  "chat.fromArchive": "Depuis les archives",
  "chat.thinking": "Réflexion…",
  "chat.send": "Envoyer le message",
  "chat.attach": "Ajouter des fichiers ou un dossier", "chat.addFiles": "Ajouter des fichiers", "chat.sendDocuments": "Envoyer des documents à lire", "chat.addFolder": "Ajouter un dossier",
  "chat.collapse": "Réduire la conversation", "chat.reveal": "Afficher la conversation",
  "chat.title": "L’arbre généalogique des {archive}",
  "chat.intro": "Explorez l’histoire de la famille, interrogez les personnes et les liens de l’arbre, et découvrez les récits conservés ici.",
  "chat.focusEditor": "Tout ce que vous écrivez ici rejoint la fiche de {name}.",
  "chat.focusViewer": "Les réponses portent ici sur {name}.",
  "chat.clearFocus": "Ne plus écrire dans la fiche de {name}",

  "family.hint": "Cliquez sur une personne pour la centrer et ouvrir sa fiche.",
  "family.children": "Enfants",
  "family.grandchildren": "Petits-enfants",
  "family.parents": "Parents",
  "family.grandparents": "Grands-parents",
  "family.greatGrandparents": "Arrière-grands-parents",
  "family.moreRelatives": "{n} autres proches - cliquez pour les voir", "family.siblings": "Frères et sœurs",
  "family.addFather": "Ajouter le père",
  "family.addMother": "Ajouter la mère",
  "family.addGrandfather": "Ajouter le grand-père",
  "family.addGrandmother": "Ajouter la grand-mère",
  "family.none": "non renseigné",
  "family.back": "Précédent",
  "family.forward": "Suivant",
  "person.born": "Naissance", "person.died": "Décès", "person.death": "Décès", "person.living": "En vie",
  "person.stillLiving": "Toujours en vie", "person.recordDeath": "Enregistrer un décès",
  "person.buried": "Sépulture", "person.burialPlaceholder": "cimetière ou lieu de repos",
  "person.lives": "Habite à", "person.residencePlaceholder": "ajouter une ville ou un pays",
  "person.clearDeath": "Retirer le décès et remettre en vie",
  "person.notRecorded": "Non renseigné", "person.birthNotRecorded": "Date de naissance non renseignée",
  "person.biography": "Biographie", "person.addBiography": "Ajouter une biographie…",
  "person.photographs": "Photographies", "person.addPhoto": "Ajouter une photo", "person.portrait": "Portrait",
  "person.whoElse": "Qui d’autre ?", "person.removePhoto": "Retirer", "person.whoElsePrompt": "Qui d’autre figure sur cette photo ?",
  "person.parents": "Parents", "person.spouse": "Conjoint", "person.children": "Enfants", "person.siblings": "Frères et sœurs",
  "person.stories": "Récits", "person.readOriginal": "Lire l’original en persan", "person.fromArchive": "Archives familiales",
  "person.notes": "Notes de la famille", "person.notePlaceholder": "Ajoutez un souvenir ou une correction…",
  "person.postNote": "Publier la note", "person.deleteNote": "Supprimer cette note",
  "person.delete": "Supprimer la personne", "person.removePortrait": "Retirer le portrait",
  "person.close": "Fermer", "person.previous": "Personne précédente", "person.next": "Personne suivante",
  "person.addName": "Nom", "person.addDate": "ajouter une date", "person.city": "ville", "person.country": "pays",
  "person.maidenName": "ajouter le nom de jeune fille", "person.nee": "née",
  "person.female": "♀ Femme", "person.male": "♂ Homme",
  "person.done": "Terminé", "person.save": "Enregistrer", "person.cancel": "Annuler",

  "fill.questionsTitle": "Questions pour la famille",
  "fill.questionsIntro": "Les anciens documents le laissent entendre sans jamais le dire. Confirmer applique la modification ; chaque réponse est consignée.",
  "fill.confirm": "Confirmer", "fill.deny": "Ce n’est pas exact", "fill.recordName": "Enregistrer le nom", "fill.notKnown": "Inconnu",
  "fill.notePlaceholder": "Ajouter une note (facultatif)", "fill.namePlaceholder": "Son nom…",
  "fill.search": "Chercher une personne à compléter…", "fill.allGenerations": "Toutes les générations",
  "fill.progress": "{complete} fiches complètes sur {total} · {gaps} incomplètes",

  "map.title": "Où la famille a vécu", "map.zoomIn": "Zoom avant", "map.zoomOut": "Zoom arrière", "map.reset": "Réinitialiser le zoom",
  "place.people": "{count} personnes dans les archives", "place.onePerson": "Une personne dans les archives",
  "place.bornHere": "Né ici", "place.diedHere": "Décédé ici", "place.bornDiedHere": "Né et décédé ici",

  "calendar.title": "L’année de la famille",
  "calendar.intro": "Les anniversaires des vivants, les jours de mémoire, et les dates des récits. Seules les dates complètes y figurent — une année seule n’a pas de jour.",
  "calendar.today": "Aujourd’hui",
  "stats.title": "La forme de la famille", "stats.intro": "Tout est compté à partir des fiches telles qu’elles sont aujourd’hui.",
  "timeline.title": "Vies et récits au fil du temps",

  "settings.title": "Réglages", "settings.back": "← Retour à l’arbre",
  "settings.language": "Langue", "settings.languageHint": "Les mots propres aux archives — noms, biographies et récits — restent dans la langue où ils ont été écrits.",
};

const DICTS: Record<Lang, Dict> = { en, fa, fr };

/** English is the fallback for anything a translation has not caught up with,
 * so a missing key shows real words rather than a key name. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const text = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? match));
}

export const parseLang = (value: string | null | undefined): Lang =>
  LANGUAGES.includes(value as Lang) ? value as Lang : "en";

/** What to call each language when telling the archivist which one to use. */
export const LANGUAGE_ENDONYM: Record<Lang, string> = { en: "English", fa: "Persian (فارسی)", fr: "French (français)" };
