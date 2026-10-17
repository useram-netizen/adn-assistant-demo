/**
 * All visitor-facing wording for the ADN assistant (spec rule 6), plus the emails.
 *
 * The widget imports this file as `@adn/copy`; the server uses it for embed.js, the AI
 * fallbacks and the emails. The wording is a placeholder (OPEN) until Tracy confirms it:
 * drop her final text in here. {name}-style placeholders are filled in by the code.
 *
 * Keep this file plain data: no imports, because the browser bundle includes it.
 */
export const copy = {
  widget: {
    /** Browser tab title when /widget is opened on its own. */
    documentTitle: 'Amicable Divorce Network assistant',
    noscript: 'Please turn on JavaScript to use the Amicable Divorce Network assistant.',
    /** Shown if this server is running without a widget build. */
    unavailable:
      'The Amicable Divorce Network assistant is not available right now. Please try again later.',
    headerTitle: 'Amicable Divorce Network',
    headerSubtitle: 'Find a vetted divorce professional',
    /** Screen reader name of the message list. */
    conversationLabel: 'Conversation with the assistant',
    /** Screen reader text before each message. */
    assistantSaid: 'Assistant:',
    youSaid: 'You:',
    typing: 'The assistant is typing…',
    back: 'Back',
    startOver: 'Start over',
    inputLabel: 'Type a message',
    inputPlaceholder: 'Type a message…',
    send: 'Send',
    opensInNewTab: '(opens in a new tab)',
    loadError:
      "Sorry, I couldn't load the assistant just now. Please check your connection and try again.",
    retry: 'Try again',
    /** Any request that fails (the visitor can retry; never a dead end). */
    requestError: 'Sorry, something went wrong on our side. Please try again.',
    rateLimited: 'You’re going a little fast for me. Please wait a moment and try again.',
  },

  /** The footer on every screen. "Privacy" links to PRIVACY_URL and is hidden while that is unset. */
  footer: {
    automated: 'Automated assistant',
    disclaimer: 'General information only, not legal advice',
    privacy: 'Privacy',
  },

  /** Text that embed.js puts on the host page. */
  embed: {
    bubbleLabel: 'Find a professional',
    closeLabel: 'Close',
    /** The iframe title, read out by screen readers. Also used in the fallback iframe code. */
    frameTitle: 'Find a divorce professional',
    /** Shown in the bubble panel for the moment before the widget appears. */
    loading: 'Loading…',
  },

  /** Replies when typed text is a question, unclear, or needs confirming. */
  fallback: {
    didNotCatch: "Sorry, I didn't catch that. You can pick one of these:",
    didNotCatchNoOptions: "Sorry, I didn't catch that. You can use Back or Start over below.",
    didYouMean: 'Did you mean {label}?',
    yes: 'Yes',
    no: 'No',
    /** After "No" to "Did you mean…?". */
    pickInstead: 'No problem. You can pick one of these:',
  },

  /** Shown once per session when the visitor may be in danger (spec: Safety). */
  safety: {
    title: 'Your safety comes first',
    message:
      "If you're in danger, call 911. National Domestic Violence Hotline: 1-800-799-7233, or text START to 88788. 988 Suicide & Crisis Lifeline: call or text 988.",
    actions: [
      { label: 'Call 911', href: 'tel:911' },
      { label: 'Call the Hotline: 1-800-799-7233', href: 'tel:18007997233' },
      { label: 'Text START to 88788', href: 'sms:88788?&body=START' },
      { label: 'Call or text 988', href: 'tel:988' },
    ],
  },

  steps: {
    welcome: {
      message:
        "Hi! I'm the Amicable Divorce Network assistant. I can help you find vetted divorce professionals near you. Are you…",
      optionDivorce: "I'm going through a divorce or considering one",
      optionProfessional: "I'm a divorce professional",
    },
    proInfo: {
      message:
        'Welcome! The Amicable Divorce Network connects people going through a divorce with professionals who are committed to amicable divorce. You can find out about membership and how to join here.',
      /** Used while JOIN_URL is not set (no button to point to). */
      messageNoLink:
        'Welcome! The Amicable Divorce Network connects people going through a divorce with professionals who are committed to amicable divorce. Thank you for your interest in joining us.',
      joinButton: 'Learn about joining',
    },
    location: {
      message: 'Which state are you in?',
      comboLabel: 'Your state',
      comboPlaceholder: 'Start typing your state…',
      noResults: 'No matching state',
      optionUk: "I'm in the UK",
      optionOutside: 'Somewhere else',
      /** "Did you mean {label}?" for the two buttons, when the visitor typed instead. */
      confirmUk: 'the UK',
      confirmOutside: 'somewhere outside the US and UK',
    },
    uk: {
      message:
        'We have a UK network with local Amicable Ambassadors who can help you. You can find them on our UK site.',
      button: 'Visit the UK network',
    },
    outside: {
      message: 'Our network covers the US and UK. Tracy, our founder, may still be able to help.',
      emailTracy: 'Email Tracy',
    },
    county: {
      message: 'Which county in {state} do you live in?',
      comboLabel: 'Your county',
      comboPlaceholder: 'Start typing your county…',
      noResults: 'No matching county',
      notSure: "I'm not sure",
    },
    countyHelp: {
      message: 'What city, town or ZIP code are you in?',
      /** The text box's hint at this step. */
      placeholder: 'City, town or ZIP code…',
      confirm: 'That sounds like {county}. Is that right?',
      yes: 'Yes',
      noPick: 'No, let me pick',
      notFound: "I couldn't tell which county that is. Please pick it from the list:",
      /** Shown before the dropdown when the visitor says "No, let me pick". */
      pick: 'Please pick your county from the list:',
    },
    stage: {
      message: 'Where are you in the process?',
      options: {
        exploring: 'Just exploring my options',
        ready: 'Ready to get started',
        in_process: 'Already in the process',
        post_divorce: 'My divorce is final, I need help with what comes after',
      },
    },
    situation: {
      message:
        "If you'd like, tell me a little about your situation in a sentence or two… Please leave out names.",
      skip: 'Skip',
      /** The text box's hint at this step. */
      placeholder: 'A sentence or two about your situation…',
      /** The acknowledgement when the AI is off or unavailable. */
      ack: 'Thank you for sharing that.',
    },
    category: {
      message: 'What kind of professional are you looking for?',
      more: 'More options',
      notSure: "I'm not sure",
      suggested: 'Suggested',
    },
    categoryMore: {
      message: 'Here are some more kinds of professionals:',
    },
    categoryHelp: {
      /** With the AI's recommendations (when the visitor described their situation). */
      recommended: 'Based on what you shared, these could be a good fit:',
      /** Without: a one-line explanation of each kind. */
      explain: 'Here is what each kind of professional does:',
      seeAll: 'See all kinds of professionals',
    },
    subcategory: {
      message: 'Is there a particular kind you need?',
      any: 'Any / not sure',
    },
    results: {
      message: 'Here are {category} who serve {county}, {state}:',
      instructions: 'Select up to 5 professionals, then tap Contact selected.',
      showMore: 'Show more',
      select: 'Select',
      selected: 'Selected',
      /** Screen reader label of each card's toggle. */
      selectNamed: 'Select {name}',
      contact: 'Contact selected ({n})',
      maxReached: 'You can select up to 5 professionals.',
      email: 'Email',
    },
    noMatch: {
      message:
        "We don't have {categoryWithArticle} listed for {county} yet. Tracy, our founder, personally helps people in this situation. Send her a message and she'll point you to someone she trusts.",
      emailTracy: 'Email Tracy',
      tryAnother: 'Try another type of professional',
      startOver: 'Start over',
    },
    contact: {
      message:
        "Great. Please tell {names} how to reach you, and I'll send them your request. You can edit the message before sending.",
    },
    tracy: {
      message:
        'Tracy will read your message personally. Please tell her how to reach you, and add anything that would help.',
    },
    done: {
      message: "Done! Your request went to {names}. You'll also get a confirmation email.",
      /** When there is no list of names to show. */
      messageNoNames: "Done! Your request was sent. You'll also get a confirmation email.",
      messageTracy: "Done! Your message went to Tracy. You'll also get a confirmation email.",
    },
    whatsNext: {
      message: 'While you wait, here are some next steps:',
      articles: 'Read our articles',
      podcast: 'Listen to our podcast',
      booking: 'Book a call with Kristy',
      anotherType: 'Find another type of professional',
      anotherTypeMessage: 'You might also find these helpful:',
      startOver: 'Start over',
    },
  },

  /** Category labels on the buttons (spec: Taxonomy, visitor label; OPEN). */
  categories: {
    attorney: 'Divorce attorney',
    mediator: 'Mediator',
    financial: 'Financial expert (e.g. CDFA)',
    coach: 'Divorce coach',
    therapist: 'Therapist or counselor',
    real_estate: 'Real estate or mortgage',
    arbitrator: 'Arbitrator',
    parenting_coordinator: 'Parenting coordinator',
    estate_attorney: 'Estate planning attorney',
    qdro_attorney: 'QDRO / retirement division attorney',
    bankruptcy_attorney: 'Bankruptcy attorney',
    paralegal: 'Paralegal / document preparer',
  },

  /** The same categories as plural nouns, for "Here are {category} who serve…". */
  categoriesPlural: {
    attorney: 'divorce attorneys',
    mediator: 'mediators',
    financial: 'financial experts',
    coach: 'divorce coaches',
    therapist: 'therapists and counselors',
    real_estate: 'real estate and mortgage professionals',
    arbitrator: 'arbitrators',
    parenting_coordinator: 'parenting coordinators',
    estate_attorney: 'estate planning attorneys',
    qdro_attorney: 'QDRO / retirement division attorneys',
    bankruptcy_attorney: 'bankruptcy attorneys',
    paralegal: 'paralegals and document preparers',
  },

  /** With an article, for "We don't have {categoryWithArticle} listed…". */
  categoriesWithArticle: {
    attorney: 'a divorce attorney',
    mediator: 'a mediator',
    financial: 'a financial expert',
    coach: 'a divorce coach',
    therapist: 'a therapist or counselor',
    real_estate: 'a real estate or mortgage professional',
    arbitrator: 'an arbitrator',
    parenting_coordinator: 'a parenting coordinator',
    estate_attorney: 'an estate planning attorney',
    qdro_attorney: 'a QDRO / retirement division attorney',
    bankruptcy_attorney: 'a bankruptcy attorney',
    paralegal: 'a paralegal or document preparer',
  },

  /** One line on what each kind of professional does (category_help without AI). */
  categoryExplanations: {
    attorney: 'Advises you on your legal rights and handles the legal side of your divorce.',
    mediator: 'A neutral person who helps you and your spouse reach agreements together.',
    financial: 'Helps you understand the money side: assets, budgets, taxes and settlements.',
    coach: 'Supports you through the process and helps you plan your next steps.',
    therapist: 'Helps you, your children or your family with the emotional side.',
    real_estate: 'Helps you sell, buy or refinance a home during or after a divorce.',
    arbitrator: 'A neutral decision-maker who settles disagreements outside court.',
    parenting_coordinator:
      'Helps separated parents follow their parenting plan and settle disputes.',
    estate_attorney: 'Updates your will, trusts and beneficiaries after a divorce.',
    qdro_attorney: 'Prepares the court orders that divide retirement accounts.',
    bankruptcy_attorney: 'Advises on debt and bankruptcy during or after a divorce.',
    paralegal: 'Helps you prepare and file divorce paperwork.',
  },

  /** Subtype buttons on the subcategory step. */
  subtypes: {
    financial: {
      cdfa: 'Certified Divorce Financial Analyst (CDFA)',
      planner: 'Planner / advisor',
      forensic: 'Forensic accountant',
      valuation: 'Business valuations',
      accountant: 'Accountant',
      insurance: 'Insurance',
    },
    coach: {
      divorce: 'Divorce coach',
      transition: 'Divorce transition coach',
      parenting: 'Parenting coach',
      life: 'Life coach',
      wellness: 'Wellness coach',
      other: 'Other coaching',
    },
    therapist: {
      adults: 'For adults',
      couples: 'For couples',
      coparenting: 'Co-parenting',
      children: 'For children',
      adolescents: 'For teenagers',
      other: 'Other',
    },
    real_estate: {
      agent: 'Agent / broker',
      mortgage: 'Mortgage lender',
      appraiser: 'Appraiser',
      interior: 'Interior design',
    },
  },

  /** Result cards. */
  cards: {
    /** Short display label for each sheet label (spec: Taxonomy). */
    professionLabels: {
      'Lawyer- Divorce and Family Law': 'Divorce & family law attorney',
      'ADR - Mediator': 'Mediator',
      Financial: 'Financial professional',
      'Financial - Certified Divorce Financial Analyst': 'CDFA',
      'Financial - Planner/Advisor': 'Financial planner / advisor',
      'Financial - Forensic Accountant': 'Forensic accountant',
      'Financial - Business Valuations': 'Business valuations',
      'Financial - Accountant': 'Accountant',
      'Financial - Insurance': 'Insurance',
      Coaching: 'Coach',
      'Coaching - Divorce': 'Divorce coach',
      'Coaching - Divorce Transition': 'Divorce transition coach',
      'Coaching - Parenting': 'Parenting coach',
      'Coaching - Life': 'Life coach',
      'Coaching - Wellness': 'Wellness coach',
      'Coaching - Other': 'Coach',
      'Mental Health': 'Therapist / counselor',
      'Mental Health - Adults': 'Therapist for adults',
      'Mental Health - Couples': 'Couples therapist',
      'Mental Health - Co-parenting': 'Co-parenting counselor',
      'Mental Health - Children': 'Child therapist',
      'Mental Health - Adolescents': 'Teen therapist',
      'Mental Health - Other': 'Therapist / counselor',
      'Real Estate': 'Real estate',
      'Real Estate - Agent/Broker': 'Real estate agent / broker',
      'Real Estate - Mortgage Lender': 'Mortgage lender',
      'Real Estate - Appraiser': 'Appraiser',
      'Real Estate - Interior Design': 'Interior designer',
      'ADR - Arbitrator': 'Arbitrator',
      'ADR - Parent Coordinator': 'Parenting coordinator',
      'Lawyer- Wills and Estate Planning': 'Estate planning attorney',
      'Lawyer- QDRO/Retirement Division': 'QDRO / retirement division attorney',
      'Lawyer- Bankruptcy': 'Bankruptcy attorney',
      Paralegal: 'Paralegal',
      'Paralegal - Paralegal Document Preparer': 'Document preparer',
    },
    badges: {
      platinum: 'Platinum Member',
      gold: 'Gold Member',
      cadp: 'Certified Amicable Divorce Professional',
      founding: 'Founding Member',
    },
    servesAllOf: 'Serves all of {state}',
    serves: 'Serves {list}',
    servesMore: 'Serves {list} + {n} more',
  },

  /** The contact form and the Tracy form. */
  form: {
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    phone: 'Phone (optional)',
    preferred: 'How should they contact you?',
    preferredTracy: 'How should Tracy contact you?',
    preferredEmail: 'Email',
    preferredPhone: 'Phone',
    message: 'Message',
    messageHint: 'You can edit this before sending.',
    consent: 'I agree to share these details with the professionals I selected.',
    consentTracy: 'I agree to share these details with Tracy.',
    privacyLink: 'Privacy policy',
    requiredMark: '(required)',
    /** Hidden from people; only bots fill it in. */
    honeypot: 'Leave this field empty',
    submit: 'Send my request',
    submitTracy: 'Send to Tracy',
    sending: 'Sending…',
    errors: {
      required: 'Please fill this in.',
      email: 'Please enter a valid email address.',
      phone: 'Please enter a valid phone number.',
      phoneNeeded: 'Please add a phone number, or choose email.',
      consent: 'Please tick this box to continue.',
      tooLong: 'Please keep this under {max} characters.',
      invalid: 'Please check this.',
      summary: 'Please check the highlighted fields.',
    },
    submitError: "Sorry, your request didn't go through. Please try again.",
    /** Requests that email people are limited per hour, so "wait a moment" would mislead. */
    rateLimited: "You've sent several requests recently. Please try again a little later.",
    /** The message pre-fill when there is no AI summary: the stage, then the visitor's own text. */
    prefillStage: {
      exploring: "I'm just exploring my options.",
      ready: "I'm ready to get started.",
      in_process: "I'm already in the process.",
      post_divorce: 'My divorce is final and I need help with what comes after.',
    },
    prefillLookingFor: "I'm looking for {categoryWithArticle} in {county}, {state}.",
    /** For a visitor outside the US and UK, who has said nothing else. */
    prefillOutside: "I'm not in the US or UK, and I'd like some help.",
  },

  /** Site keys (data-site) as shown in emails ("…the assistant on {site}"). */
  sites: {
    divorceamicably: 'divorceamicably.com',
    amicabledivorce: 'amicabledivorce.net',
    unknown: 'the Amicable Divorce Network website',
  },

  /** Emails. The client confirmation is visitor-facing; the others go to professionals and Tracy. */
  emails: {
    brand: 'Amicable Divorce Network',
    fields: {
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      preferred: 'Preferred contact',
      location: 'Location',
      lookingFor: 'Looking for',
      stage: 'Where they are in the process',
      message: 'Message',
      notGiven: 'Not given',
    },
    /** How some values are written: "Fulton County, Georgia"; "Divorce coach – Parenting coach". */
    values: {
      location: '{county}, {state}',
      lookingForSubtype: '{category} – {subtype}',
    },
    pro: {
      subject: 'New client request: {category} in {county}, {state}',
      intro: 'You have a new client request.',
      foundYou: 'This person found you through the Amicable Divorce Network assistant on {site}.',
      replyHint: 'Reply to this email to answer them directly.',
    },
    client: {
      subject: 'Your request through the Amicable Divorce Network',
      greeting: 'Hi {firstName},',
      intro: 'Thank you for using the Amicable Divorce Network assistant. Your request went to:',
      after: 'They will contact you directly. Here is a copy of your message:',
      whatsNext: "What's next",
      signoff: 'Warm wishes,\nThe Amicable Divorce Network',
    },
    tracy: {
      subject: 'Message for Tracy: {category} in {location}',
      /** no_match when the visitor's category or location is not known. */
      subjectGeneral: 'Message for Tracy from the assistant',
      subjectOutside: 'Message for Tracy from a visitor outside the US and UK',
      intro: 'A visitor asked for your help through the assistant on {site}.',
      /** {location} is "Fulton County, Georgia" (values.location), or just the state. */
      reasonNoMatch: "We don't have {categoryWithArticle} listed for {location}.",
      /** no_match when the visitor's category or location is not known. */
      reasonNoMatchGeneral: "We don't have a match for what they are looking for.",
      reasonOutside: 'The visitor is outside the US and UK.',
      replyHint: 'Reply to this email to answer them directly.',
    },
    clientTracy: {
      subject: 'Your message to Tracy at the Amicable Divorce Network',
      greeting: 'Hi {firstName},',
      intro: 'Thank you for your message. Tracy will get back to you personally.',
      after: 'Here is a copy of your message:',
      signoff: 'Warm wishes,\nThe Amicable Divorce Network',
    },
    /** Subject of the optional copy to LEAD_COPY_TO. */
    leadCopySubject: '[Copy] {subject}',
    /** In that copy, before the names of the professionals the request went to. */
    leadCopySentTo: 'This request went to:',
    /** EMAIL_MODE=redirect: everything goes to EMAIL_REDIRECT_TO with this subject. */
    redirectSubject: '[TEST → {to}] {subject}',
  },
} as const;

export type Copy = typeof copy;

/** Fills {placeholders} in a wording string. Unknown placeholders are left as they are. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}
