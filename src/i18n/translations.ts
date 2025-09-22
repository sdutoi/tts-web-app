export type UILang = 'en' | 'de';

type Dict = Record<string, string>;

// Simple flat key dictionary. Use dot notation for grouping.
export const translations: Record<UILang, Dict> = {
  en: {
    'landing.title': 'Practice Dialogues',
    'landing.subtitle': "Select your target language, then pick a sample sentence that best matches your current comfort level. We'll use that to jump you straight into the dialogue builder.",
    'landing.pickSentence': 'Pick a representative sentence',
    'landing.changeLanguage': 'Change language',
    'footer.storyAssistant': 'Story Assistant',
    'footer.dialogueBuilder': 'Dialogue Builder (manual)',
    'footer.docs': 'Docs',
    'common.language': 'Language',
    'common.level': 'Level',
    'common.scenario': 'Scenario',
    'common.generate': 'Generate',
    'common.refine': 'Refine',
    'common.words': 'Words',
    'common.speed': 'Speed',
    'common.format': 'Format',
    'common.download': 'Download audio',
    'common.generateAudio': 'Generate audio',
    'dialogue.title': 'Dialogue Builder',
    'dialogue.scenarioVocabulary': 'Scenario Vocabulary (random 5)',
    'dialogue.reshuffle': 'Reshuffle',
    'dialogue.yourOwnWords': 'Your Own Words (any language)',
    'dialogue.yourOwnWords.hint': 'Added words are encouraged in the dialogue (they may be adapted to target language).',
    'dialogue.chooseVoicesTitle': 'Choose Voices',
    'dialogue.chooseVoicesDescription': 'Preview voices reading a sample sentence, then assign two distinct voices (A & B). This does not change the dialogue text—only playback.',
    'dialogue.dialogueTitle': 'Dialogue',
    'dialogue.playbackSettings': 'Playback Settings',
    'dialogue.downloadFull': 'Download Full Dialogue (beta)',
    'dialogue.buildingCombined': 'Building combined audio… Please wait.',
    'dialogue.currentVoices': 'Current',
    'story.title': 'Story assistant',
    'story.generate': 'Generate story',
    'story.refine': 'Refine story',
    'story.vocabulary': 'Vocabulary',
    'story.miniStory': 'Mini Story',
    'labels.selected': 'Selected',
    'labels.custom': 'Custom',
    'placeholders.styleTone': 'Style / tone (optional)',
    'placeholders.extraInstructions': 'Extra instructions (optional)',
    'placeholders.interests': 'Interests / themes (e.g., travel, cooking, sci-fi)',
    'placeholders.optionalSentence': 'Optional sentence to include (in target language)',
    'placeholders.optionalStyle': 'Optional style/tone (e.g., funny, dramatic)',
    'seed.sentence': 'Seed sentence:'
  },
  de: {
    'landing.title': 'Dialogübungen',
    'landing.subtitle': 'Wähle deine Zielsprache und dann einen Beispielsatz, der deinem aktuellen Niveau entspricht. Damit springst du direkt in den Dialog-Builder.',
    'landing.pickSentence': 'Wähle einen repräsentativen Satz',
    'landing.changeLanguage': 'Sprache ändern',
    'footer.storyAssistant': 'Geschichten-Assistent',
    'footer.dialogueBuilder': 'Dialog Builder (manuell)',
    'footer.docs': 'Dokumentation',
    'common.language': 'Sprache',
    'common.level': 'Niveau',
    'common.scenario': 'Szenario',
    'common.generate': 'Erzeugen',
    'common.refine': 'Verfeinern',
    'common.words': 'Wörter',
    'common.speed': 'Geschw.',
    'common.format': 'Format',
    'common.download': 'Audio herunterladen',
    'common.generateAudio': 'Audio erzeugen',
    'dialogue.title': 'Dialog-Builder',
    'dialogue.scenarioVocabulary': 'Szenario-Wortschatz (zufällige 5)',
    'dialogue.reshuffle': 'Neu mischen',
    'dialogue.yourOwnWords': 'Eigene Wörter (beliebige Sprache)',
    'dialogue.yourOwnWords.hint': 'Hinzugefügte Wörter werden im Dialog bevorzugt (sie können angepasst werden).',
    'dialogue.chooseVoicesTitle': 'Stimmen wählen',
    'dialogue.chooseVoicesDescription': 'Höre Beispielsätze an und wähle zwei unterschiedliche Stimmen (A & B). Dies ändert nur die Wiedergabe – nicht den Text.',
    'dialogue.dialogueTitle': 'Dialog',
    'dialogue.playbackSettings': 'Wiedergabe-Einstellungen',
    'dialogue.downloadFull': 'Gesamten Dialog herunterladen (Beta)',
    'dialogue.buildingCombined': 'Kombiniertes Audio wird erstellt… Bitte warten.',
    'dialogue.currentVoices': 'Aktuell',
    'story.title': 'Geschichten-Assistent',
    'story.generate': 'Geschichte erzeugen',
    'story.refine': 'Geschichte verfeinern',
    'story.vocabulary': 'Wortschatz',
    'story.miniStory': 'Kurzgeschichte',
    'labels.selected': 'Ausgewählt',
    'labels.custom': 'Benutzerdefiniert',
    'placeholders.styleTone': 'Stil / Ton (optional)',
    'placeholders.extraInstructions': 'Zusätzliche Anweisungen (optional)',
    'placeholders.interests': 'Interessen / Themen (z.B. Reisen, Kochen, Sci-Fi)',
    'placeholders.optionalSentence': 'Optionaler Satz (in Zielsprache)',
    'placeholders.optionalStyle': 'Optionaler Stil/Ton (z.B. lustig, dramatisch)',
    'seed.sentence': 'Ausgangssatz:'
  }
};

export function translate(lang: UILang, key: string, vars?: Record<string, string | number>): string {
  const dict = translations[lang] || translations.en;
  let value = dict[key] || translations.en[key] || key;
  if (vars) {
    for (const [k,v] of Object.entries(vars)) {
      value = value.replace(new RegExp('\\{'+k+'\\}','g'), String(v));
    }
  }
  return value;
}
