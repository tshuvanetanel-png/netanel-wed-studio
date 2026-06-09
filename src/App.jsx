import { useState, useEffect, useRef } from 'react';

const CATEGORY_QUERIES = {
  tradesman:  "שרברב|חשמלאי|נגר|טכנאי|מסגר|צבעי|גבס|אינסטלטור",
  beauty:     "ספא|קוסמטיקה|ציפורניים|מאפר|סלון יופי|טיפולי פנים",
  clinic:     "קליניקה|פיזיותרפיה|נטורופתיה|דיקור|רפלקסולוגיה|פסיכולוג|אוסטאופתיה",
  hair:       "מספרה|תספורת|עיצוב שיער|ברבר",
  optics:     "אופטיקה|משקפיים|עדשות מגע",
  law:        'עורך דין|משרד עורכי דין|עו"ד',
  accounting: "רואה חשבון|הנהלת חשבונות|יועץ מס",
  fitness:    "חדר כושר|פילאטיס|יוגה|סטודיו כושר",
  kids:       "גן ילדים|צהרון|מעון|חוג ילדים",
  pets:       "וטרינר|טיפוח כלבים|חנות חיות",
  photo:      "צלם|סטודיו צילום|צילום אירועים",
  driving:    "מורה נהיגה|בית ספר לנהיגה",
};

const PKG_RULES = {
  tradesman:  { pkg:"בייסיק",  price:"₪890"   },
  beauty:     { pkg:"פרימיום", price:"₪2,890"  },
  clinic:     { pkg:"סטנדרט", price:"₪1,690"  },
  hair:       { pkg:"סטנדרט", price:"₪1,690"  },
  optics:     { pkg:"סטנדרט", price:"₪1,690"  },
  law:        { pkg:"פרימיום", price:"₪2,890"  },
  accounting: { pkg:"סטנדרט", price:"₪1,690"  },
  fitness:    { pkg:"סטנדרט", price:"₪1,690"  },
  kids:       { pkg:"בייסיק",  price:"₪890"   },
  pets:       { pkg:"בייסיק",  price:"₪890"   },
  photo:      { pkg:"סטנדרט", price:"₪1,690"  },
  driving:    { pkg:"בייסיק",  price:"₪890"   },
};

function extractOwnerName(name) {
  const words = name.trim().split(" ");
  const skipWords = ["בית","קפה","מסעדת","מספרת","קליניקת","ספא","סטודיו","מרכז","שירותי"];
  for (let i = 0; i < words.length; i++) {
    if (!skipWords.includes(words[i]) && words[i].length > 2) return words[i];
  }
  return words[0] || "שלום";
}

function analyzeReviews(reviews = []) {
  const allText = reviews.map(r => r.text || "").join(" ");
  const positiveKeywords = [
    "מקצועי","מהיר","אמין","ידידותי","נקי","טעים","מומלץ","שירות מעולה",
    "מחיר הוגן","זמין","איכות","נפלא","מרשים","טוב מאוד","פנטסטי"
  ];
  const found = positiveKeywords.filter(kw => allText.includes(kw));
  return found.length > 0 ? found.slice(0, 4) : ["שירות מקצועי", "מומלץ בחום"];
}

function buildDescription(place, reviewHighlights) {
  const cats = (place.types || [])
    .filter(t => !["point_of_interest","establishment","food"].includes(t))
    .map(t => t.replace(/_/g," "))
    .slice(0,2)
    .join(", ");
  const highlights = reviewHighlights.slice(0,2).join(" ו");
  const base = place.editorial_summary?.overview || "";
  if (base) return base;
  return `${place.name} — ${cats || "עסק מקומי"} ב${place.vicinity?.split(",")[1]?.trim() || "ישראל"}. לקוחות מדגישים: ${highlights}.`;
}

async function fetchRealBusinesses(apiKey, city, categoryId, pageToken = null) {
  const query = CATEGORY_QUERIES[categoryId] || CATEGORY_QUERIES.tradesman;
  const keyword = query.split("|")[0];

  const callAPI = async (googleUrl) => {
    const res = await fetch(`/.netlify/functions/places?url=${encodeURIComponent(googleUrl)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  let searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(keyword + " " + city)}&language=he&region=il&key=${apiKey}`;
  if (pageToken) searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&key=${apiKey}`;

  const searchData = await callAPI(searchUrl);
  if (!searchData.results) throw new Error("API Error: " + JSON.stringify(searchData));

  const noWebsite = searchData.results.filter(p => !p.website);
  const detailed  = await Promise.all(
    noWebsite.slice(0, 8).map(async (place) => {
      const detailUrl  = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,formatted_address,rating,user_ratings_total,opening_hours,website,photos,reviews,editorial_summary,types,vicinity&language=he&key=${apiKey}`;
      const detailData = await callAPI(detailUrl);
      return detailData.result || place;
    })
  );

  const defaultColors = {
    restaurant: ["#1A0A00","#C8860A","#FFF8EE"],
    tradesman:  ["#0A1628","#E67E00","#FFFFFF"],
    beauty:     ["#2A0A2A","#D4679A","#FFF0F5"],
    clinic:     ["#002B4A","#0096C7","#F0F8FF"],
  };

  const bizList = detailed
    .filter(p => {
      if (p.website || !p.formatted_phone_number) return false;
      const blocked = ["restaurant","food","cafe","bar","meal_takeaway","meal_delivery","bakery","night_club","liquor_store"];
      const types = p.types || [];
      return !blocked.some(t => types.includes(t));
    })
    .map((p) => {
      const reviewHighlights = analyzeReviews(p.reviews);
      const pkgRule = PKG_RULES[categoryId];
      const photoRef = p.photos?.[0]?.photo_reference;
      const hours = p.opening_hours?.weekday_text?.join(" | ") ||
                    p.opening_hours?.periods ? "ראה שעות בגוגל" : "לא צוין";
      return {
        id: `${p.place_id || p.name}_${city}_${categoryId}`.replace(/[\s:]/g,"_"),
        name: p.name,
        category: categoryId,
        categoryLabel: keyword,
        phone: p.formatted_phone_number?.replace(/[^0-9\-]/g,"").replace("972","0") || "—",
        address: p.formatted_address || p.vicinity || "—",
        city,
        rating: p.rating || 0,
        reviews: p.user_ratings_total || 0,
        hours,
        hasWebsite: false,
        photoUrl: photoRef ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${apiKey}` : null,
        dominantColors: defaultColors[categoryId] || ["#111827","#6366F1","#F8FAFC"],
        description: buildDescription(p, reviewHighlights),
        reviewHighlights,
        rawReviews: (p.reviews || []).slice(0,5).map(r => ({ author: r.author_name, rating: r.rating, text: r.text?.slice(0,200), time: r.relative_time_description })),
        package: pkgRule.pkg,
        packagePrice: pkgRule.price,
        ownerName: extractOwnerName(p.name),
        placeId: p.place_id,
      };
    });

  return { bizList, nextPageToken: searchData.next_page_token || null, city, categoryId };
}

const MOCK_BUSINESSES = [
  {
    id:1, name:"מספרת דני", category:"beauty", categoryLabel:"מספרה",
    phone:"0521234567", address:"רחוב הרצל 14, תל אביב", city:"תל אביב",
    rating:4.7, reviews:83, hours:"א׳-ו׳ 09:00-19:00", hasWebsite:false,
    dominantColors:["#2C1810","#D4A96A","#F5F0EB"],
    description:"מספרה שכונתית עם 15 שנות ניסיון, מתמחה בתספורות גברים ועיצוב זקן.",
    reviewHighlights:["מקצועי","מהיר","מחיר הוגן","ידידותי"],
    rawReviews:[
      {author:"יוסי כ.",rating:5,text:"דני מקצועי ברמה אחרת. תספורת מושלמת, מהיר ומדויק.",time:"לפני שבוע"},
      {author:"מיכל ל.",rating:5,text:"הכי טוב בסביבה, מחיר הוגן ושירות מצוין.",time:"לפני חודש"},
    ],
    package:"סטנדרט", packagePrice:"₪1,690", ownerName:"דני",
  },
  {
    id:2, name:"שרברבות כהן", category:"tradesman", categoryLabel:"שרברב",
    phone:"0549876543", address:"שד׳ בן גוריון 7, חיפה", city:"חיפה",
    rating:4.2, reviews:41, hours:"א׳-ה׳ 08:00-18:00", hasWebsite:false,
    dominantColors:["#1A3A5C","#F0A500","#FFFFFF"],
    description:"שרברב מוסמך עם 20 שנות ניסיון, זמין לתקלות דחופות.",
    reviewHighlights:["אמין","מהיר","מקצועי","זמין"],
    rawReviews:[
      {author:"רון א.",rating:4,text:"הגיע תוך שעה, תיקן מהר ובמחיר הוגן.",time:"לפני שבועיים"},
      {author:"שירה מ.",rating:5,text:"מקצועי ואמין, ממליצה בחום.",time:"לפני חודש"},
    ],
    package:"בייסיק", packagePrice:"₪890", ownerName:"כהן",
  },
  {
    id:3, name:"קפה הגינה", category:"restaurant", categoryLabel:"קפה",
    phone:"035551234", address:"רחוב דיזנגוף 88, תל אביב", city:"תל אביב",
    rating:4.5, reviews:127, hours:"כל השבוע 07:30-22:00", hasWebsite:false,
    dominantColors:["#2D5A27","#F7E7CE","#8B4513"],
    description:"קפה בוטיק עם גינה ירוקה, ארוחות בוקר כל היום ועוגות ביתיות.",
    reviewHighlights:["אווירה נפלאה","קפה מעולה","עוגות טעימות","שירות חם"],
    rawReviews:[
      {author:"נועה ר.",rating:5,text:"המקום הכי אינטימי בתל אביב. הקפה מעולה והעוגות ביתיות.",time:"לפני 3 ימים"},
      {author:"אבי ש.",rating:4,text:"אווירה נהדרת, שירות נחמד. קצת המתנה אבל שווה.",time:"לפני שבוע"},
    ],
    package:"פרימיום", packagePrice:"₪2,890", ownerName:"הגינה",
  },
  {
    id:4, name:"קליניקת ד״ר לוי", category:"clinic", categoryLabel:"קליניקה",
    phone:"097654321", address:"רחוב וייצמן 3, נתניה", city:"נתניה",
    rating:4.9, reviews:56, hours:"א׳-ה׳ 08:00-17:00", hasWebsite:false,
    dominantColors:["#0077B6","#90E0EF","#FFFFFF"],
    description:"קליניקה פרטית לרפואה כללית, תורים זמינים תוך 24 שעות.",
    reviewHighlights:["מקצועי","אנושי","זמין","מסביר היטב"],
    rawReviews:[
      {author:"חנה פ.",rating:5,text:"ד״ר לוי מסביר הכל בסבלנות ומקצועיות. הרופא הכי טוב שפגשתי.",time:"לפני שבוע"},
      {author:"דוד ג.",rating:5,text:"מקצועי ואנושי. תור תוך יום.",time:"לפני חודשיים"},
    ],
    package:"סטנדרט", packagePrice:"₪1,690", ownerName:"ד״ר לוי",
  },
  {
    id:5, name:"ספא אורה", category:"beauty", categoryLabel:"ספא",
    phone:"0533334455", address:"רחוב רוטשילד 22, ראשון לציון", city:"ראשון לציון",
    rating:4.8, reviews:33, hours:"א׳-ו׳ 10:00-20:00", hasWebsite:false,
    dominantColors:["#7B2D8B","#F8BBD9","#FFF9F9"],
    description:"ספא יוקרתי המתמחה בטיפולי פנים ועיסויים מותאמים אישית.",
    reviewHighlights:["מרגיע","מקצועי","אווירה יוקרתית","תוצאות מדהימות"],
    rawReviews:[
      {author:"מאיה ד.",rating:5,text:"חוויה מדהימה. אורה מקצועית ברמה גבוהה מאוד.",time:"לפני שבוע"},
      {author:"תמי כ.",rating:5,text:"הכי טוב שהייתי. יוצאת חדשה לגמרי.",time:"לפני חודש"},
    ],
    package:"פרימיום", packagePrice:"₪2,890", ownerName:"אורה",
  },
];

const SALES_SYSTEM_PROMPT = `Role: You are an elite, world-class sales and copywriting expert specializing in high-conversion, ultra-short WhatsApp B2B cold outreach. Your goal is to generate localized, hyper-personalized, and razor-sharp messages for local businesses that do not have a website on Google Maps.

Guiding Principles:
1. Keep it brief. Business owners are busy. No fluff, no long introductions, no "My name is...". Go straight to the point.
2. WhatsApp is a dialogue. Never send links in Message 1. The only goal of Message 1 is to get a "Yes" or "Send it" from the prospect.
3. Use simple, direct, and Israeli-business-friendly Hebrew (not overly formal, but highly professional and confident).

Here is the exact 3-Message Sequence pattern you must follow. You will dynamically inject the business details based on the data provided.

### MESSAGE 1: THE HOOK
"היי [שם העסק], הגעתי אליכם מגוגל. ראיתי שיש לכם המלצות מעולות אבל אין לכם אתר, וחבל – אתם מפספסים לקוחות למתחרים. 

בניתי לכם סקיצה מהירה ב-AI לאתר שמתאים בול לעסק. אפשר לשלוח קישור להצצה?"

### MESSAGE 2: THE DEMO (sent ONLY after prospect replies "Yes")
"הנה הקישור: [קישור לאתר]

האתר כבר מותאם לנייד וכולל את הפרטים שלכם. כמובן שנעשה שינויים ותיקונים לפי מה שתבחר. תציץ ותגיד לי מה דעתך."

### MESSAGE 3: THE OFFER & CLOSE
"הדיל הוא כזה: אני מעלה לך את האתר רשמית, עושה את כל התיקונים שתרצה, וסוגר לך חבילה קומפלט לשנה: אתר + דומיין + אחסון.

חשוב לא פחות – זה לא סתם אתר באוויר: האתר מונגש ומותאם מלא לקריטריונים המשפטיים על פי החוק בישראל, כדי שתהיו מכוסים מכל הכיוונים.

הכל כלול, תשלום חד-פעמי של [סכום] ש"ח וזהו. בלי דמי מנוי חודשיים ובלי כאבי ראש – חצי רק כשסוגרים, והחצי השני רק כשהאתר עולה לאוויר ורואים שהכל מוכן.

מרימים את זה לאוויר?"

Task: Output ONLY the 3 messages, each clearly labeled as הודעה 1, הודעה 2, הודעה 3. Maintain exact formatting and line breaks. Replace placeholders with the actual business details provided. For Message 2, keep [קישור לדמו] as a placeholder.`;

async function generateMessagesAI(biz) {
  const userPrompt = `Generate the 3-message WhatsApp sequence for this business:
- Business Name: ${biz.name}
- Business Type: ${biz.categoryLabel}
- City: ${biz.city}
- Rating: ${biz.rating} stars (${biz.reviews} reviews)
- Price Package: ${biz.packagePrice}
- WhatsApp: https://wa.me/972${biz.phone.replace(/[^0-9]/g,"").replace(/^0/,"")}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SALES_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  const data = await response.json();
  return data.content?.[0]?.text || "שגיאה בייצור הודעות";
}

function detectGender(name) {
  const femaleWords = ["שרה","רחל","לאה","מרים","דינה","אורה","חנה","נועה","מיכל","שושנה","ליאת","גלית","שירה","מאיה","נטע","הילה","יפית","אורית","דפנה","ענת","קרן","נעמה","שלי","אלה","נגה","ירדן","יונית","עינת","אלונה","מורן","דנה","מור","ספיר","עדי","גל","נילי","פנינה","זהבה","אסתר","מזל","שמחה","ריקי","קליניקת","מרפאת","סטודיו","ספא","סלון","מכון","מרפאה"];
  const lower = name.toLowerCase();
  return femaleWords.some(w => lower.includes(w.toLowerCase())) ? "female" : "male";
}

function generateMessages(biz) {
  const wa       = `https://wa.me/972${biz.phone.replace(/[^0-9]/g,"").replace(/^0/,"")}`;
  const isFemale = detectGender(biz.name + " " + (biz.ownerName||"")) === "female";
  const vipCode  = biz.name.replace(/[^א-תa-zA-Z0-9]/g,"").substring(0,8).toUpperCase() + "-VIP";

  const rejectedText = isFemale
    ? `סגורה, יקרה 🙏\n\nולמרות שכרגע המתנה שלי לא מתאימה לך — האם יש לך חברה או משפחה שתרצי להעביר להם את המתנה הזאת?\n\nכל בעל עסק/נותנת שירות שתפני אליי — אשמח לפרגן לו עיצוב חינם לאתר לעסק שלו, ובתור תודה לך אני נותן לך אופציה להעניק להם 10% הנחה\nשכמובן גם את תקבלי אם תחליטי לסגור איתי בעתיד 😊\n\nהקוד האישי שלך: ${vipCode}\nכל מי שיגיע עם הקוד הזה — אני יודע שבא דרכך 💪`
    : `סגור איש, יקר 🙏\n\nולמרות שכרגע המתנה שלי לא מתאימה לך — האם יש לך חבר או משפחה שתרצה להעביר להם את המתנה הזאת?\n\nכל בעל עסק/נותן שירות שתפנה אליי — אשמח לפרגן לו עיצוב חינם לאתר לעסק שלו, ובתור תודה לך אני נותן לך אופציה להעניק להם 10% הנחה\nשכמובן גם אתה תקבל אם תחליט לסגור איתי בעתיד 😊\n\nהקוד האישי שלך: ${vipCode}\nכל מי שיגיע עם הקוד הזה — אני יודע שבא דרכך 💪`;

  return {
    msg1: {
      label: "💬 הודעה 1 — ההוק",
      sublabel: "שלח עכשיו · אפס מכירה · מחכה ל'כן'",
      color: "#6366F1", waLink: wa,
      text: `היי ${biz.name}, הגעתי אליכם מגוגל. ראיתי שיש לכם המלצות מעולות אבל אין לכם אתר, וחבל – אתם מפספסים לקוחות למתחרים. \n\nבניתי לכם סקיצה מהירה ב-AI לאתר שמתאים בול לעסק. אפשר לשלוח קישור להצצה?`,
    },
    msg2: {
      label: "🔗 הודעה 2 — הדמו",
      sublabel: "רק אחרי שענו · שלח קישור",
      color: "#0EA5E9", waLink: wa,
      text: `הנה הקישור: [הכנס כאן קישור לדמו]\n\nהאתר כבר מותאם לנייד וכולל את הפרטים שלכם. כמובן שנעשה שינויים ותיקונים לפי מה שתבחר. תציץ ותגיד לי מה דעתך.`,
    },
    msg3: {
      label: "💰 הודעה 3 — הסגירה",
      sublabel: "24–48 שעות אחרי · ביטחון · חלוקת תשלום",
      color: "#10B981", waLink: wa,
      text: `הדיל הוא כזה: אני מעלה לך את האתר רשמית, עושה את כל התיקונים שתרצה, וסוגר לך חבילה קומפלט לשנה: אתר + דומיין + אחסון.\n\nחשוב לא פחות – זה לא סתם אתר באוויר: האתר מונגש ומותאם מלא לקריטריונים המשפטיים על פי החוק בישראל, כדי שתהיו מכוסים מכל הכיוונים.\n\nהכל כלול, תשלום חד-פעמי של ${biz.packagePrice.replace("₪","")} ש"ח וזהו. בלי דמי מנוי חודשיים ובלי כאבי ראש – חצי רק כשסוגרים, והחצי השני רק כשהאתר עולה לאוויר ורואים שהכל מוכן.\n\nמרימים את זה לאוויר?`,
    },
    msgRejected: {
      label: "🤝 לא מעוניין — מפה לאוזן",
      sublabel: "שלח אחרי דחייה · קוד ייחודי",
      color: "#F59E0B", waLink: wa,
      vipCode,
      text: rejectedText,
    },
  };
}

function generatePrompt(biz) {
  const year = new Date().getFullYear();
  const pkgDetails = {
    "בייסיק": `
מבנה: דף נחיתה אחד ארוך (one-pager) עם הסקשנים הבאים בסדר הזה:
① HERO — כותרת ראשית + תת-כותרת + כפתור CTA ("שלח הודעה" / "התקשר עכשיו")
② עליי / אודות — 3-4 משפטים על העסק, טון אישי
③ שירותים — 3-4 כרטיסים עם אייקון + כותרת + תיאור קצר
④ ביקורות — ${biz.reviews} ביקורות + דירוג ${biz.rating}⭐ בעיצוב בולט
⑤ צור קשר — טלפון + כתובת + שעות + כפתור WhatsApp`,

    "סטנדרט": `
מבנה: 4 עמודים מקושרים עם ניווט עליון:
① בית — Hero + תמצית שירותים + ביקורות מובחרות + CTA
② שירותים — רשת כרטיסים מפורטת עם תיאורים ומחירים אופציונליים
③ אודות — סיפור העסק + ערכים + תמונת הצוות placeholder
④ צור קשר — טופס פנייה + Google Maps מוטמע + פרטים מלאים
בכל עמוד: כפתור WhatsApp צף + ביקורות גוגל (${biz.rating}⭐ × ${biz.reviews})`,

    "פרימיום": `
מבנה: עד 6 עמודים מלאים:
① בית — Hero מרשים עם אנימציה + highlights + CTA כפול
② שירותים/תפריט — קטלוג/תפריט דיגיטלי עם קטגוריות, תמונות ומחירים
③ גלריה — grid תמונות עם lightbox
④ ביקורות — כל ${biz.reviews} הביקורות בעיצוב premium
⑤ הזמנות/תיאום — טופס מתקדם עם בחירת שירות + תאריך
⑥ צור קשר — Google Maps + פרטים + טופס + כפתורי סושיאל
בכל עמוד: WhatsApp צף + אנימציות scroll-triggered`,
  };

  const wa = `https://wa.me/972${biz.phone.replace(/[^0-9]/g,"").replace(/^0/,"")}`;

  const reviewsBlock = biz.rawReviews?.length > 0
    ? biz.rawReviews.map((r,i) =>
        `ביקורת ${i+1} (${r.rating}⭐ | ${r.author} | ${r.time}):\n"${r.text}"`
      ).join("\n\n")
    : "טען ביקורות מגוגל Maps API";

  const highlightsBlock = (biz.reviewHighlights || []).join(" · ");

  return `אתה מעצב ומפתח אתרים מקצועי ברמה הגבוהה ביותר. המשימה: לבנות אתר עסקי מושלם שמוכר ומביא לקוחות — כל המידע כאן לקוח ישירות מגוגל.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 פרטי העסק — מגוגל
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
שם העסק:       ${biz.name}
קטגוריה:        ${biz.categoryLabel}
כתובת:          ${biz.address}
טלפון:           ${biz.phone}
WhatsApp:      ${wa}
שעות פעילות:  ${biz.hours}
דירוג גוגל:     ${biz.rating} ⭐ מתוך 5 (${biz.reviews} ביקורות)
תיאור העסק:   ${biz.description}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ ביקורות אמיתיות מגוגל — השתמש בהן באתר
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
נושאים שחוזרים בביקורות: ${highlightsBlock}

${reviewsBlock}

הנחיה: הצג את הביקורות האמיתיות האלה בסקשן ביקורות מעוצב.
השתמש בציטוטים המלאים, שם הלקוח, הדירוג ומתי נכתבה.
אל תמציא ביקורות — רק מה שכתוב למעלה.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 זהות ויזואלית
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
צבעי המותג (מתמונות גוגל): ${biz.dominantColors.join("  |  ")}
— Primary: ${biz.dominantColors[0]}
— Accent: ${biz.dominantColors[1] || biz.dominantColors[0]}
— Background: ${biz.dominantColors[2] || "#FFFFFF"}

טיפוגרפיה: פונט ייחודי מ-Google Fonts לפי אופי העסק.
אסור: Arial, Inter, Roboto, Open Sans.
${biz.category === "restaurant" ? "מסעדה/קפה → Playfair Display / Lora" :
  biz.category === "beauty"     ? "יופי/ספא → Cormorant Garamond / Raleway" :
  biz.category === "clinic"     ? "קליניקה → Nunito / Source Serif Pro" :
                                  "בעל מקצוע → Oswald / Barlow Condensed"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 חבילה: ${biz.package} — ${biz.packagePrice}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${pkgDetails[biz.package]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ דרישות חובה — אין לדלג על אף אחת
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. כל טקסטי האתר — מבוססים על המידע האמיתי מגוגל למעלה. אל תמציא.
2. כפתור WhatsApp צף — ימין למטה, קישור: ${wa} | pulse animation
3. סקשן ביקורות — הציטוטים האמיתיים מגוגל, עם שם + דירוג + תאריך
4. דירוג ${biz.rating}⭐ ו-${biz.reviews} ביקורות — בולטים בדף הבית
5. Mobile-first — מותאם נייד במלואו
6. RTL מלא — dir="rtl", עברית שוטפת ומקצועית
7. Hero — תמונת רקע unsplash רלוונטית + overlay + טקסט מבוסס על תיאור העסק
8. אנימציות — fade-in + slide-up, hover effects

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
♿ סרגל נגישות — חובה חוקית בישראל
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
הוסף סרגל נגישות צף בצד ימין של המסך (position: fixed, right: 0, top: 50%) עם הכפתורים הבאים:

א+ — הגדלת גופן (font-size: 110% על ה-body)
א- — הקטנת גופן
🌑 — ניגודיות גבוהה (filter: invert(1) hue-rotate(180deg) על ה-body)
🔤 — גופן קריא (font-family: Arial, sans-serif על הכל)
🔗 — הדגשת קישורים (underline + outline על כל a)

הסרגל סגור כברירת מחדל, נפתח בלחיצה על אייקון ♿.
עיצוב: רקע לבן/כהה, כפתורים עגולים, צל קל.
כל ההגדרות נשמרות ב-localStorage.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ פוטר חוקי — חובה מוחלטת
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
בתחתית הדף שתי שורות נפרדות:

שורה 1 — פרטי העסק:
${biz.name} | ${biz.address}
${biz.phone} | ${biz.hours}

שורה 2 — קישורים משפטיים (חיוניים למניעת תביעות):
מדיניות פרטיות | תנאי שימוש | הצהרת נגישות

שורה 3 — זכויות יוצרים:
הפוטר עכשיו מציג:
© 2026 כל הזכויות שמורות לנתנאל תשובה | Netanel Teshuva
אתר זה הוכן כדמו בלבד ואינו מורשה לשימוש מסחרי ללא אישור בכתב
עוצב על ידי נתנאל תשובה | Netanel Teshuva

הוסף עמודים נפרדים (sections נסתרים או popups) לכל אחד מהקישורים המשפטיים:

מדיניות פרטיות — "האתר אוסף פרטי קשר לצורך יצירת קשר בלבד. המידע אינו מועבר לצד שלישי. לפניות: ${biz.phone}"

תנאי שימוש — "השימוש באתר מהווה הסכמה לתנאי השימוש. כל התכנים באתר מוגנים בזכויות יוצרים. אין להעתיק ללא אישור."

הצהרת נגישות — "אתר זה פועל לעמוד בדרישות תקן נגישות ישראלי 5568. לפניות בנושא נגישות: ${biz.phone}"

עיצוב: רקע כהה, טקסט אפור בהיר, "Netanel Teshuva" בצבע ה-Accent.
השורה חייבת להיות גלויה תמיד — אין להסתיר אותה ב-CSS.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 פלט נדרש
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
קובץ HTML/CSS/JS אחד בלבד (index.html). ללא הסברים, ללא markdown — רק הקוד.`;
}

const PKG = {
  "בייסיק":  { bg:"#1E3A5F", text:"#60A5FA", label:"🥉 בייסיק" },
  "סטנדרט": { bg:"#1A3A2A", text:"#34D399", label:"🥈 סטנדרט" },
  "פרימיום": { bg:"#3A1A2A", text:"#F472B6", label:"🥇 פרימיום" },
};

function CopyBtn({ text, label, small }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),2200); }}
      style={{
        background: copied ? "#059669" : "rgba(99,102,241,0.18)",
        border: `1px solid ${copied ? "#059669" : "rgba(99,102,241,0.35)"}`,
        color: copied ? "#fff" : "#A5B4FC",
        borderRadius: 8, padding: small ? "5px 10px" : "8px 14px",
        fontSize: small ? 11 : 12, fontWeight: 700, cursor: "pointer",
        transition: "all 0.2s", whiteSpace: "nowrap",
      }}>{copied ? "✅ הועתק" : label}</button>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.08)", marginBottom:0 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={()=>onChange(t.id)} style={{
          flex:1, padding:"11px 4px", border:"none", background:"transparent",
          color: active===t.id ? "#A5B4FC" : "#475569",
          borderBottom: active===t.id ? "2px solid #6366F1" : "2px solid transparent",
          fontSize:12, fontWeight:700, cursor:"pointer", transition:"all 0.15s"
        }}>{t.label}</button>
      ))}
    </div>
  );
}

const CLAUDE_MONTHLY  = 74;
const NETLIFY_MONTHLY = 0;
const GOOGLE_API_MO   = 37;
const TOTAL_FIXED     = CLAUDE_MONTHLY + GOOGLE_API_MO;
const FIXED_PER_DEAL  = 25;
const PAYPAL_PCT      = 0.035;
const FUND_PCT        = 0.10;
const DEMO_COST       = 18;

function Modal({ biz, onClose, dealData, updateDeal, calcDeal, isClosed }) {
  const [tab, setTab]           = useState("msg");
  const msgs                    = generateMessages(biz);
  const prompt                  = generatePrompt(biz);
  const pkg                     = PKG[biz.package];
  const wa                      = `https://wa.me/972${biz.phone.replace(/[^0-9]/g,"").replace(/^0/,"")}`;
  const msgList                 = [msgs.msg1, msgs.msg2, msgs.msg3, msgs.msgRejected];
  const deal                    = calcDeal(biz.id, biz.packagePrice);
  const d                       = dealData[biz.id] || {};
  const [aiText, setAiText]     = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCopied, setAiCopied] = useState(false);

  const handleAI = async () => {
    setAiLoading(true); setAiText("");
    try {
      const result = await generateMessagesAI(biz);
      setAiText(result);
    } catch(e) {
      setAiText("שגיאה: " + e.message);
    } finally { setAiLoading(false); }
  };

  const inputStyle = {
    background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)",
    borderRadius:8, padding:"8px 11px", color:"#F1F5F9", fontSize:13,
    outline:"none", width:"100%", boxSizing:"border-box"
  };

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", backdropFilter:"blur(6px)",
      zIndex:200, display:"flex", alignItems:"center", justifyContent:"center",
      padding:12, animation:"fadeIn 0.18s ease"
    }} onClick={onClose}>
      <div style={{
        background:"#0C1420", border:"1px solid rgba(255,255,255,0.09)",
        borderRadius:20, width:"100%", maxWidth:580,
        height:"88vh",
        display:"flex", flexDirection:"column",
        animation:"slideUp 0.22s ease", boxShadow:"0 40px 120px rgba(0,0,0,0.6)"
      }} onClick={e=>e.stopPropagation()}>

        <div style={{ padding:"16px 18px 12px", borderBottom:"1px solid rgba(255,255,255,0.07)", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:11 }}>
            <div style={{ width:42,height:42,borderRadius:10,flexShrink:0, background:`linear-gradient(135deg,${biz.dominantColors[0]},${biz.dominantColors[1]||"#555"})`, display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:800,color:"#fff" }}>{biz.name[0]}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15,fontWeight:800,color:"#F1F5F9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{biz.name}</div>
              <div style={{ display:"flex",gap:7,marginTop:3,flexWrap:"wrap" }}>
                <span style={{ fontSize:11,color:"#FBBF24" }}>⭐ {biz.rating} ({biz.reviews})</span>
                <span style={{ fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:5,background:pkg.bg,color:pkg.text }}>{pkg.label}</span>
                <span style={{ fontSize:11,color:"#34D399",fontWeight:700 }}>{biz.packagePrice}</span>
                {isClosed && <span style={{ fontSize:10,background:"rgba(74,222,128,0.2)",color:"#4ADE80",padding:"2px 7px",borderRadius:5,fontWeight:700 }}>✅ נסגר</span>}
              </div>
            </div>
            <div style={{ display:"flex",gap:7,flexShrink:0 }}>
              <a href={wa} target="_blank" rel="noreferrer" style={{ background:"#25D366",color:"#fff",borderRadius:8,padding:"6px 11px",fontSize:12,fontWeight:700,textDecoration:"none" }}>💬 WA</a>
              <button onClick={onClose} style={{ background:"rgba(255,255,255,0.07)",border:"none",borderRadius:8,width:30,height:30,color:"#64748B",cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center" }}>✕</button>
            </div>
          </div>
          <div style={{ fontSize:11,color:"#334155",marginTop:8,display:"flex",gap:12 }}>
            <span>📍 {biz.address}</span><span>🕐 {biz.hours}</span>
          </div>
        </div>

        <div style={{ flexShrink:0, borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display:"flex" }}>
            {[
              { id:"msg",    label:"💬 הודעות" },
              { id:"prompt", label:"🤖 פרומפט" },
              { id:"info",   label:"📊 סיכום" },
              { id:"deal",   label:"💰 חשבון" },
            ].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                flex:1, padding:"10px 4px", border:"none", background:"transparent",
                color: tab===t.id ? "#A5B4FC" : "#475569",
                borderBottom: tab===t.id ? "2px solid #6366F1" : "2px solid transparent",
                fontSize:11, fontWeight:700, cursor:"pointer", transition:"all 0.15s"
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"14px 18px 18px", minHeight:0 }}>

          {tab === "msg" && (
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <div style={{ background:"rgba(139,92,246,0.08)",border:"1px solid rgba(139,92,246,0.25)",borderRadius:12,padding:"12px 14px" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom: aiText ? 10 : 0 }}>
                  <div>
                    <div style={{ fontSize:13,fontWeight:700,color:"#A78BFA" }}>✨ צור הודעות עם AI</div>
                    <div style={{ fontSize:11,color:"#6D28D9",marginTop:2 }}>מותאמות אישית לעסק הזה בדיוק</div>
                  </div>
                  <button onClick={handleAI} disabled={aiLoading} style={{
                    background:"linear-gradient(135deg,#7C3AED,#6366F1)",color:"#fff",border:"none",
                    borderRadius:9,padding:"8px 16px",fontSize:12,fontWeight:700,
                    cursor:aiLoading?"wait":"pointer",opacity:aiLoading?0.7:1,whiteSpace:"nowrap"
                  }}>{aiLoading ? "⏳ יוצר..." : "🤖 צור עכשיו"}</button>
                </div>
                {aiText && (
                  <div>
                    <pre style={{ background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"12px",fontSize:12,color:"#CBD5E1",whiteSpace:"pre-wrap",fontFamily:"inherit",lineHeight:1.7,maxHeight:280,overflowY:"auto" }}>{aiText}</pre>
                    <button onClick={()=>{ navigator.clipboard.writeText(aiText); setAiCopied(true); setTimeout(()=>setAiCopied(false),2000); }} style={{
                      marginTop:8,background:aiCopied?"#059669":"rgba(99,102,241,0.2)",border:"none",borderRadius:7,
                      padding:"6px 14px",color:aiCopied?"#fff":"#A5B4FC",fontSize:11,fontWeight:700,cursor:"pointer"
                    }}>{aiCopied?"✅ הועתק!":"📋 העתק הכל"}</button>
                  </div>
                )}
              </div>

              <div style={{ fontSize:11,color:"#334155",textAlign:"center" }}>— או השתמש בהודעות המוכנות —</div>

              {msgList.map((msg,i)=>(
                <div key={i} style={{ background:"rgba(255,255,255,0.03)",border:`1px solid ${msg.color}25`,borderRadius:12,overflow:"hidden" }}>
                  <div style={{ padding:"9px 12px",background:`${msg.color}12`,borderBottom:`1px solid ${msg.color}18`,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                    <div>
                      <span style={{ fontSize:12,fontWeight:800,color:msg.color }}>{msg.label}</span>
                      <span style={{ fontSize:10,color:"#475569",marginRight:7 }}>{msg.sublabel}</span>
                    </div>
                    <CopyBtn text={msg.text} label="📋 העתק" small />
                  </div>
                  <div style={{ padding:"11px 13px",fontSize:12,color:"#CBD5E1",lineHeight:1.75,whiteSpace:"pre-wrap",fontFamily:"inherit" }}>{msg.text}</div>
                </div>
              ))}
            </div>
          )}

          {tab === "prompt" && (
            <div>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:9 }}>
                <div style={{ fontSize:11,color:"#475569" }}>הדבק ישירות ב-Claude Design</div>
                <CopyBtn text={prompt} label="📋 העתק פרומפט" />
              </div>
              <pre style={{ background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.18)",borderRadius:11,padding:"13px 14px",fontSize:11,color:"#94A3B8",whiteSpace:"pre-wrap",wordBreak:"break-word",lineHeight:1.75,fontFamily:"monospace",margin:0 }}>{prompt}</pre>
            </div>
          )}

          {tab === "info" && (
            <div style={{ display:"flex",flexDirection:"column",gap:9 }}>
              {[
                { icon:"🏪",label:"שם העסק",  val:biz.name },
                { icon:"📂",label:"קטגוריה",  val:biz.categoryLabel },
                { icon:"📍",label:"כתובת",    val:biz.address },
                { icon:"📞",label:"טלפון",    val:biz.phone },
                { icon:"🕐",label:"שעות",     val:biz.hours },
                { icon:"⭐",label:"דירוג",    val:`${biz.rating} (${biz.reviews} ביקורות)` },
                { icon:"🌐",label:"אתר קיים", val:"❌ אין אתר — הזדמנות!" },
                { icon:"📦",label:"חבילה",    val:`${biz.package} — ${biz.packagePrice}` },
              ].map(row=>(
                <div key={row.label} style={{ display:"flex",gap:10,padding:"9px 12px",background:"rgba(255,255,255,0.03)",borderRadius:9,alignItems:"flex-start" }}>
                  <span style={{ fontSize:15,lineHeight:1.4,flexShrink:0 }}>{row.icon}</span>
                  <div>
                    <div style={{ fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:0.8 }}>{row.label}</div>
                    <div style={{ fontSize:13,color:row.label==="אתר קיים"?"#34D399":row.label==="חבילה"?"#F472B6":"#CBD5E1",marginTop:2,fontWeight:row.label==="חבילה"?700:400 }}>{row.val}</div>
                  </div>
                </div>
              ))}
              {biz.reviewHighlights?.length > 0 && (
                <div style={{ padding:"9px 12px",background:"rgba(255,255,255,0.03)",borderRadius:9 }}>
                  <div style={{ fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:0.8,marginBottom:6 }}>💬 נושאים בביקורות</div>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>
                    {biz.reviewHighlights.map(h=><span key={h} style={{ fontSize:11,background:"rgba(99,102,241,0.15)",color:"#818CF8",padding:"3px 9px",borderRadius:12 }}>{h}</span>)}
                  </div>
                </div>
              )}
              <div style={{ padding:"9px 12px",background:"rgba(255,255,255,0.03)",borderRadius:9 }}>
                <div style={{ fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:0.8,marginBottom:7 }}>🎨 צבעי מותג</div>
                <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                  {biz.dominantColors.map((c,i)=>(
                    <div key={i} style={{ display:"flex",alignItems:"center",gap:5 }}>
                      <div style={{ width:20,height:20,borderRadius:5,background:c,border:"2px solid rgba(255,255,255,0.15)" }}/>
                      <span style={{ fontSize:10,color:"#475569" }}>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "deal" && (
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <div style={{ fontSize:11,color:"#475569",marginBottom:2 }}>
                הכנס את הפרטים הסופיים של העסקה — החישוב אוטומטי
              </div>

              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                {[
                  { field:"salePrice", label:"💵 מחיר מכירה סופי (₪)", placeholder:biz.packagePrice.replace("₪","") },
                  { field:"discount",  label:"🏷️ הנחה שנתת (₪)",        placeholder:"0" },
                  { field:"domain",    label:"🌐 דומיין (₪)",            placeholder:"37" },
                  { field:"hosting",   label:"🖥️ אחסון (₪)",             placeholder:"3" },
                ].map(({field,label,placeholder})=>(
                  <div key={field}>
                    <div style={{ fontSize:11,color:"#64748B",marginBottom:5,fontWeight:600 }}>{label}</div>
                    <input type="number" value={d[field]||""} onChange={e=>updateDeal(biz.id,field,e.target.value)}
                      placeholder={placeholder} style={inputStyle} />
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize:11,color:"#64748B",marginBottom:5,fontWeight:600 }}>📝 הערה (אופציונלי)</div>
                <input type="text" value={d.note||""} onChange={e=>updateDeal(biz.id,"note",e.target.value)}
                  placeholder="למשל: שילם מראש / הנחה על חבר מוביל / ..." style={inputStyle} />
              </div>

              {/* ── מעקב זמן עבודה ── */}
              <div style={{ background:"rgba(139,92,246,0.06)",border:"1px solid rgba(139,92,246,0.2)",borderRadius:12,padding:"13px 14px" }}>
                <div style={{ fontSize:12,fontWeight:800,color:"#A78BFA",marginBottom:10 }}>⏱️ זמן עבודה על העסקה</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8 }}>
                  {[
                    { field:"timeLead",    label:"🔍 איתור + פנייה",     placeholder:"0" },
                    { field:"timeDemo",    label:"🎨 בניית דמו",          placeholder:"0" },
                    { field:"timeFix",     label:"🔧 תיקונים + שינויים",  placeholder:"0" },
                    { field:"timeDeploy",  label:"🚀 העלאה + דומיין",     placeholder:"0" },
                  ].map(({field,label,placeholder})=>(
                    <div key={field}>
                      <div style={{ fontSize:10,color:"#64748B",marginBottom:4,fontWeight:600 }}>{label} (דק׳)</div>
                      <input type="number" min="0" value={d[field]||""} onChange={e=>updateDeal(biz.id,field,e.target.value)}
                        placeholder={placeholder} style={{...inputStyle, fontSize:12}} />
                    </div>
                  ))}
                </div>
                {(() => {
                  const totalMin = (parseFloat(d.timeLead)||0) + (parseFloat(d.timeDemo)||0) + (parseFloat(d.timeFix)||0) + (parseFloat(d.timeDeploy)||0);
                  const totalHours = (totalMin / 60).toFixed(1);
                  const profit = calcDeal(biz.id, biz.packagePrice).profit;
                  const ratePerHour = totalMin > 0 ? Math.round(profit / (totalMin / 60)) : 0;
                  return (
                    <div style={{ background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"10px 12px",display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8 }}>
                      <div style={{ textAlign:"center" }}>
                        <div style={{ fontSize:16,fontWeight:900,color:"#A78BFA" }}>{totalMin > 0 ? totalHours : "—"}</div>
                        <div style={{ fontSize:10,color:"#64748B",marginTop:2 }}>שעות סה״כ</div>
                      </div>
                      <div style={{ textAlign:"center" }}>
                        <div style={{ fontSize:16,fontWeight:900,color: ratePerHour>=200?"#4ADE80":ratePerHour>=100?"#FB923C":"#F87171" }}>
                          {ratePerHour > 0 ? `₪${ratePerHour.toLocaleString()}` : "—"}
                        </div>
                        <div style={{ fontSize:10,color:"#64748B",marginTop:2 }}>רווח לשעה</div>
                      </div>
                      <div style={{ textAlign:"center" }}>
                        <div style={{ fontSize:16,fontWeight:900,color:"#38BDF8" }}>{totalMin > 0 ? `${totalMin}` : "—"}</div>
                        <div style={{ fontSize:10,color:"#64748B",marginTop:2 }}>דקות סה״כ</div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* ── תשלום חצי-חצי ── */}
              {(() => {
                const saleAmt = parseFloat(d.salePrice) || parseInt(biz.packagePrice.replace(/[^0-9]/g,""));
                const half = Math.round(saleAmt / 2);
                const firstPaid  = d.firstPaid  === "true";
                const secondPaid = d.secondPaid === "true";
                const firstDate  = d.firstDate  || "";
                const secondDate = d.secondDate || "";
                const bothPaid   = firstPaid && secondPaid;
                const neitherPaid = !firstPaid && !secondPaid;

                return (
                  <div style={{ background: bothPaid ? "rgba(74,222,128,0.06)" : neitherPaid ? "rgba(255,255,255,0.02)" : "rgba(251,146,60,0.06)", border:`1px solid ${bothPaid?"rgba(74,222,128,0.25)":neitherPaid?"rgba(255,255,255,0.08)":"rgba(251,146,60,0.25)"}`, borderRadius:12, padding:"13px 14px" }}>
                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                      <div style={{ fontSize:12,fontWeight:800,color: bothPaid?"#4ADE80":"#F1F5F9" }}>
                        💳 מעקב תשלומים — חצי/חצי
                      </div>
                      <div style={{ fontSize:11,fontWeight:700,padding:"2px 9px",borderRadius:20,
                        background: bothPaid?"rgba(74,222,128,0.2)":firstPaid?"rgba(251,146,60,0.2)":"rgba(100,116,139,0.2)",
                        color: bothPaid?"#4ADE80":firstPaid?"#FB923C":"#94A3B8"
                      }}>
                        {bothPaid ? "✅ שולם הכל" : firstPaid ? "⏳ ממתין לחצי שני" : "🔴 טרם שולם"}
                      </div>
                    </div>

                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      {/* חצי ראשון */}
                      <div style={{ background: firstPaid?"rgba(74,222,128,0.08)":"rgba(255,255,255,0.03)", border:`1px solid ${firstPaid?"rgba(74,222,128,0.3)":"rgba(255,255,255,0.08)"}`, borderRadius:10, padding:"11px 12px" }}>
                        <div style={{ fontSize:10,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:0.7,marginBottom:6 }}>חצי ראשון — בסגירה</div>
                        <div style={{ fontSize:18,fontWeight:900,color: firstPaid?"#4ADE80":"#F1F5F9",marginBottom:8 }}>₪{half.toLocaleString()}</div>
                        <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:7 }}>
                          <button onClick={()=>updateDeal(biz.id,"firstPaid", firstPaid?"false":"true")} style={{
                            flex:1, padding:"6px 0", borderRadius:7, border:"none", fontSize:11, fontWeight:700, cursor:"pointer",
                            background: firstPaid?"rgba(74,222,128,0.2)":"rgba(99,102,241,0.2)",
                            color: firstPaid?"#4ADE80":"#A5B4FC"
                          }}>{firstPaid ? "✅ התקבל" : "סמן כהתקבל"}</button>
                        </div>
                        <div>
                          <div style={{ fontSize:10,color:"#475569",marginBottom:3 }}>📅 תאריך קבלה</div>
                          <input type="date" value={firstDate} onChange={e=>updateDeal(biz.id,"firstDate",e.target.value)}
                            style={{ width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,padding:"5px 8px",color:"#F1F5F9",fontSize:11,outline:"none",boxSizing:"border-box" }}/>
                        </div>
                      </div>

                      {/* חצי שני */}
                      <div style={{ background: secondPaid?"rgba(74,222,128,0.08)":firstPaid?"rgba(251,146,60,0.06)":"rgba(255,255,255,0.02)", border:`1px solid ${secondPaid?"rgba(74,222,128,0.3)":firstPaid?"rgba(251,146,60,0.3)":"rgba(255,255,255,0.06)"}`, borderRadius:10, padding:"11px 12px" }}>
                        <div style={{ fontSize:10,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:0.7,marginBottom:6 }}>חצי שני — בהעלאה</div>
                        <div style={{ fontSize:18,fontWeight:900,color: secondPaid?"#4ADE80":firstPaid?"#FB923C":"#64748B",marginBottom:8 }}>₪{(saleAmt - half).toLocaleString()}</div>
                        <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:7 }}>
                          <button onClick={()=>{ if(!firstPaid){alert("סמן קודם את החצי הראשון כהתקבל");return;} updateDeal(biz.id,"secondPaid", secondPaid?"false":"true"); }} style={{
                            flex:1, padding:"6px 0", borderRadius:7, border:"none", fontSize:11, fontWeight:700, cursor:"pointer",
                            background: secondPaid?"rgba(74,222,128,0.2)":firstPaid?"rgba(251,146,60,0.2)":"rgba(100,116,139,0.1)",
                            color: secondPaid?"#4ADE80":firstPaid?"#FB923C":"#475569"
                          }}>{secondPaid ? "✅ התקבל" : firstPaid ? "⏳ סמן כהתקבל" : "ממתין לחצי ראשון"}</button>
                        </div>
                        <div>
                          <div style={{ fontSize:10,color:"#475569",marginBottom:3 }}>📅 תאריך קבלה</div>
                          <input type="date" value={secondDate} onChange={e=>updateDeal(biz.id,"secondDate",e.target.value)}
                            disabled={!firstPaid}
                            style={{ width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,padding:"5px 8px",color: firstPaid?"#F1F5F9":"#334155",fontSize:11,outline:"none",boxSizing:"border-box",opacity:firstPaid?1:0.4 }}/>
                        </div>
                      </div>
                    </div>

                    {/* סיכום תשלומים */}
                    <div style={{ marginTop:10,padding:"9px 12px",background:"rgba(0,0,0,0.2)",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6 }}>
                      <div style={{ fontSize:11,color:"#64748B" }}>
                        התקבל עד כה:
                        <span style={{ fontWeight:800,color:"#4ADE80",marginRight:5 }}>
                          ₪{((firstPaid?half:0)+(secondPaid?(saleAmt-half):0)).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize:11,color:"#64748B" }}>
                        נותר לגבות:
                        <span style={{ fontWeight:800,color: bothPaid?"#4ADE80":"#F87171",marginRight:5 }}>
                          ₪{(saleAmt - (firstPaid?half:0) - (secondPaid?(saleAmt-half):0)).toLocaleString()}
                        </span>
                      </div>
                      {firstPaid && !secondPaid && (
                        <div style={{ fontSize:10,padding:"2px 9px",borderRadius:12,background:"rgba(251,146,60,0.15)",color:"#FB923C",fontWeight:700 }}>
                          🔔 ממתין ל-₪{(saleAmt-half).toLocaleString()} עם העלאת האתר
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div style={{ background:"rgba(99,102,241,0.06)",border:"1px solid rgba(99,102,241,0.15)",borderRadius:12,padding:"14px 16px",marginTop:4 }}>
                <div style={{ fontSize:12,fontWeight:800,color:"#A5B4FC",marginBottom:12 }}>📊 פירוט עסקה</div>
                <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
                  {[
                    { l:"💵 מחיר מכירה",         v:`₪${deal.sale.toLocaleString()}`, c:"#F1F5F9", bold:true },
                    { l:"🌐 דומיין",              v:`- ₪${deal.domain}`,              c:"#F87171" },
                    { l:"🖥️ אחסון",               v:`- ₪${deal.hosting}`,             c:"#F87171" },
                    { l:"🤖 קלוד (בניית אתר)",    v:`- ₪${deal.claude}`,              c:"#F87171" },
                    { l:"🎨 דמו + Netlify",        v:`- ₪${deal.demo}`,                c:"#F87171" },
                    { l:"💳 PayPal (3.5%)",        v:`- ₪${deal.paypal}`,              c:"#F87171" },
                    { l:"📊 עלויות קבועות (חלק)", v:`- ₪${deal.fixed}`,              c:"#94A3B8" },
                    { l:"🏦 קרן חירום (10%)",     v:`- ₪${deal.fund}`,                c:"#FDE047" },
                  ].map(row=>(
                    <div key={row.l} style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <span style={{ fontSize:12,color:"#94A3B8" }}>{row.l}</span>
                      <span style={{ fontSize:12,fontWeight:row.bold?700:400,color:row.c }}>{row.v}</span>
                    </div>
                  ))}
                  <div style={{ height:1,background:"rgba(255,255,255,0.08)",margin:"4px 0" }}/>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <span style={{ fontSize:13,fontWeight:800,color:"#F1F5F9" }}>✅ רווח מהעסקה</span>
                    <span style={{ fontSize:16,fontWeight:900,color: deal.profit>0?"#4ADE80":"#F87171" }}>₪{deal.profit.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize:10,color:"#334155",textAlign:"center",marginTop:2 }}>
                    עלויות קבועות: קלוד ₪{CLAUDE_MONTHLY} + Google API ₪{GOOGLE_API_MO} = ₪{TOTAL_FIXED}/חודש
                    · מחולק לפי ~{FIXED_PER_DEAL}₪ לעסקה
                  </div>
                </div>
              </div>

              {isClosed && (() => {
                const closeDate = new Date(dealData[biz.id]?.closeDate || Date.now());
                const renewDate = new Date(closeDate);
                renewDate.setFullYear(renewDate.getFullYear() + 1);
                renewDate.setMonth(renewDate.getMonth() - 1);
                const daysUntilRenew = Math.ceil((renewDate - Date.now()) / (1000*60*60*24));
                const actualSale = parseFloat(dealData[biz.id]?.salePrice) || parseInt(biz.packagePrice.replace(/[^0-9]/g,""));
                const renewalPrice = Math.round(200 + actualSale * 0.10);
                const renewMsg = `היי ${biz.name}, שנה עברה מהר! האתר שלך חוגג שנה באוויר ♻️\n\nהגיע הזמן לחדש את הדומיין והאחסון לשנה הבאה כדי שימשיך לעבוד ולגייס לקוחות.\n\nהעלות היא רק ${renewalPrice} ש"ח לכל השנה הקרובה — זה מכסה את עלויות השרתים והדומיין + טיפול שלי בהכל כדי שיהיה לך ראש שקט. לחדש?`;

                return (
                  <div style={{ background:"rgba(234,179,8,0.06)",border:"1px solid rgba(234,179,8,0.2)",borderRadius:12,padding:"13px 14px",marginTop:4 }}>
                    <div style={{ fontSize:12,fontWeight:800,color:"#FDE047",marginBottom:8 }}>🔔 תזכורת חידוש שנתי</div>
                    <div style={{ marginBottom:10 }}>
                      <div style={{ fontSize:11,color:"#78716C",marginBottom:4 }}>📅 תאריך סגירת עסקה</div>
                      <input type="date" value={dealData[biz.id]?.closeDate || new Date().toISOString().split("T")[0]}
                        onChange={e => updateDeal(biz.id, "closeDate", e.target.value)}
                        style={{ background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"7px 10px",color:"#F1F5F9",fontSize:12,outline:"none" }}/>
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:"1px solid rgba(234,179,8,0.15)" }}>
                      <span style={{ fontSize:12,color:"#94A3B8" }}>📤 שלח תזכורת ב</span>
                      <span style={{ fontSize:12,fontWeight:700,color: daysUntilRenew <= 0 ? "#F87171" : daysUntilRenew <= 30 ? "#FB923C" : "#FDE047" }}>
                        {renewDate.toLocaleDateString("he-IL")}
                        {daysUntilRenew <= 0 ? " ⚠️ הגיע הזמן!" : daysUntilRenew <= 30 ? ` (בעוד ${daysUntilRenew} ימים)` : ` (בעוד ${Math.ceil(daysUntilRenew/30)} חודשים)`}
                      </span>
                    </div>
                    <div style={{ marginTop:10 }}>
                      <div style={{ fontSize:11,color:"#78716C",marginBottom:6 }}>💬 הודעת החידוש המוכנה</div>
                      <pre style={{ background:"rgba(0,0,0,0.25)",borderRadius:8,padding:"10px 12px",fontSize:11,color:"#CBD5E1",whiteSpace:"pre-wrap",fontFamily:"inherit",lineHeight:1.7 }}>{renewMsg}</pre>
                      <button onClick={()=>navigator.clipboard.writeText(renewMsg)} style={{ marginTop:6,background:"rgba(234,179,8,0.15)",border:"1px solid rgba(234,179,8,0.3)",color:"#FDE047",borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer" }}>
                        📋 העתק הודעת חידוש
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUSES = [
  { id:"new",      label:"🆕 חדש",        color:"#64748B", bg:"rgba(100,116,139,0.18)" },
  { id:"sent1",    label:"📤 הוק נשלח",   color:"#818CF8", bg:"rgba(129,140,248,0.18)" },
  { id:"sent2",    label:"🔗 דמו נשלח",   color:"#38BDF8", bg:"rgba(56,189,248,0.18)"  },
  { id:"followup", label:"⏳ פולואו-אפ",  color:"#FB923C", bg:"rgba(251,146,60,0.18)"  },
  { id:"closed",   label:"✅ נסגר",        color:"#4ADE80", bg:"rgba(74,222,128,0.22)"  },
  { id:"rejected", label:"❌ לא מעוניין", color:"#F87171", bg:"rgba(248,113,113,0.15)" },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]));

const CATS = [
  { id:"tradesman", label:"🔧 בעלי מקצוע" },
  { id:"beauty",    label:"💅 ספא / יופי"  },
  { id:"clinic",    label:"🏥 קליניקות"    },
  { id:"hair",      label:"✂️ מספרות"      },
];
const PAGE_SIZE = 20;

function StatusDropdown({ bizId, leadStatus, setStatusWithDate }) {
  const [open, setOpen]   = useState(false);
  const [above, setAbove] = useState(false);
  const btnRef            = useRef(null);
  const current           = STATUS_MAP[leadStatus[bizId] || "new"];

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setAbove(window.innerHeight - rect.bottom < 220);
    }
    setOpen(p => !p);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!btnRef.current?.closest("[data-dropdown]")?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div data-dropdown="" style={{ position:"relative" }} onClick={e => { e.stopPropagation(); e.preventDefault(); }}>
      <button ref={btnRef} onClick={handleOpen} style={{
        display:"flex", alignItems:"center", gap:5,
        background:current.bg, border:`1px solid ${current.color}50`,
        color:current.color, borderRadius:8, padding:"4px 9px",
        fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap"
      }}>{current.label} <span style={{ fontSize:9,opacity:0.7 }}>▾</span></button>

      {open && (
        <div style={{
          position:"fixed", zIndex:999,
          background:"#0F1923", border:"1px solid rgba(255,255,255,0.14)",
          borderRadius:10, overflow:"hidden", minWidth:160,
          boxShadow:"0 16px 48px rgba(0,0,0,0.7)",
          top: (() => {
            if (!btnRef.current) return 0;
            const r = btnRef.current.getBoundingClientRect();
            return above ? r.top - 6 - (STATUSES.length * 36) : r.bottom + 4;
          })(),
          left: (() => {
            if (!btnRef.current) return 0;
            return btnRef.current.getBoundingClientRect().left;
          })(),
        }}>
          {STATUSES.map(s => (
            <button key={s.id} onClick={() => { setStatusWithDate(bizId, s.id); setOpen(false); }}
              style={{
                display:"block", width:"100%", textAlign:"right",
                padding:"9px 14px", border:"none", fontSize:12, fontWeight:600,
                background:(leadStatus[bizId]||"new")===s.id ? s.bg : "transparent",
                color:(leadStatus[bizId]||"new")===s.id ? s.color : "#94A3B8",
                cursor:"pointer", borderBottom:"1px solid rgba(255,255,255,0.04)"
              }}>{s.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function App() {
  const [apiKey, setApiKey]             = useState(() => load("apiKey", ""));
  const [showKey, setShowKey]           = useState(false);
  const [businesses, setBusinesses]     = useState(MOCK_BUSINESSES);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [isLive, setIsLive]             = useState(false);
  const [leadStatus, setLeadStatus]     = useState(() => load("leadStatus", {}));
  const [contactDates, setContactDates] = useState(() => load("contactDates", {}));
  const [view, setView]                 = useState(() => load("view", "table"));
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCat, setFilterCat]       = useState("all");
  const [filterPkg, setFilterPkg]       = useState("all");
  const [searchName, setSearchName]     = useState("");
  const [minRating, setMinRating]       = useState(0);
  const [sortBy, setSortBy]             = useState("rating");
  const [page, setPage]                 = useState(1);
  const [open, setOpen]                 = useState(null);
  const [dealData, setDealData]         = useState(() => load("dealData", {}));
  const [fundWithdrawals, setFundWithdrawals] = useState(() => load("fundWithdrawals", []));
  const [showFund, setShowFund]         = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [showCSV, setShowCSV]           = useState(false);
  const [csvCopied, setCsvCopied]       = useState(false);
  const [pageTokens, setPageTokens]     = useState([]);
  const [loadingMore, setLoadingMore]   = useState(false);

  useEffect(() => { save("leadStatus",    leadStatus);    }, [leadStatus]);
  useEffect(() => { save("contactDates",  contactDates);  }, [contactDates]);
  useEffect(() => { save("dealData",      dealData);      }, [dealData]);
  useEffect(() => { save("fundWithdrawals", fundWithdrawals); }, [fundWithdrawals]);
  useEffect(() => { save("view",          view);          }, [view]);
  useEffect(() => { if (apiKey) save("apiKey", apiKey);   }, [apiKey]);

  const updateDeal = (bizId, field, val) =>
    setDealData(prev => ({ ...prev, [bizId]: { ...(prev[bizId]||{}), [field]: val } }));

  const calcDeal = (bizId, packagePrice) => {
    const d        = dealData[bizId] || {};
    const sale     = parseFloat(d.salePrice) || parseInt(packagePrice.replace(/[^0-9]/g,""));
    const domain   = parseFloat(d.domain)   || 0;
    const hosting  = parseFloat(d.hosting)  || 0;
    const claude   = 15;
    const demo     = DEMO_COST;
    const paypal   = Math.round(sale * PAYPAL_PCT);
    const fixed    = FIXED_PER_DEAL;
    const fund     = Math.round(sale * FUND_PCT);
    const total    = domain + hosting + claude + demo + paypal + fixed + fund;
    const profit   = sale - total;
    return { sale, domain, hosting, claude, demo, paypal, fixed, fund, total, profit };
  };

  const setStatusWithDate = (bizId, statusId) => {
    setLeadStatus(prev => ({ ...prev, [bizId]: statusId }));
    if (statusId === "sent1" && !contactDates[bizId]) {
      setContactDates(prev => ({ ...prev, [bizId]: new Date().toISOString() }));
    }
  };

  const daysSince = (bizId) => {
    if (!contactDates[bizId]) return null;
    const diff = Date.now() - new Date(contactDates[bizId]).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const generateCSV = () => {
    const headers = ["שם","קטגוריה","עיר","טלפון","דירוג","ביקורות","חבילה","מחיר","סטטוס","ימים מפנייה"];
    const rows = businesses.map(b => [
      b.name, b.categoryLabel, b.city, b.phone,
      b.rating, b.reviews, b.package, b.packagePrice,
      STATUS_MAP[leadStatus[b.id]||"new"].label.replace(/[^\w\u0590-\u05FF ]/g,""),
      daysSince(b.id) ?? "לא נפנה"
    ]);
    return [headers, ...rows].map(r => r.join(",")).join("\n");
  };

  const exportCSV = () => setShowCSV(p => !p);
  const copyCSV = () => {
    navigator.clipboard.writeText(generateCSV());
    setCsvCopied(true);
    setTimeout(() => setCsvCopied(false), 2000);
  };

  const addWithdrawal = () => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) return;
    setFundWithdrawals(prev => [...prev, {
      amount: amt,
      note: withdrawNote || "משיכת חירום",
      date: new Date().toLocaleDateString("he-IL")
    }]);
    setWithdrawAmount(""); setWithdrawNote("");
  };

  const ALL_CITIES = ["תל אביב","ירושלים","חיפה","באר שבע","נתניה","ראשון לציון","פתח תקווה","אשדוד","בת ים","הרצליה"];
  const ALL_CATS        = ["tradesman","beauty","clinic","hair"];
  const ALL_CATS_EXTRA  = ["optics","law","accounting","fitness","kids","pets","photo","driving"];

  const dedup = (existing, newItems) => {
    const seen = new Set(existing.map(b => b.id));
    return [...existing, ...newItems.filter(b => !seen.has(b.id))];
  };

  const handleSearch = async () => {
    if (!apiKey.trim()) { setBusinesses(MOCK_BUSINESSES); setIsLive(false); return; }
    setLoading(true); setError(""); setPageTokens([]);
    try {
      const allCombos = ALL_CITIES.flatMap(city => ALL_CATS.map(cat => ({ city, cat })));
      const results = await Promise.allSettled(
        allCombos.map(({ city, cat }) =>
          fetchRealBusinesses(apiKey.trim(), city, cat).catch(() => ({ bizList:[], nextPageToken:null, city, categoryId:cat }))
        )
      );
      const allBiz    = results.flatMap(r => r.status==="fulfilled" ? r.value.bizList : []);
      const allTokens = results
        .filter(r => r.status==="fulfilled" && r.value.nextPageToken)
        .map(r => ({ city: r.value.city, cat: r.value.categoryId, token: r.value.nextPageToken }));

      setBusinesses(prev => {
        const existing = prev === MOCK_BUSINESSES ? [] : prev;
        return dedup(existing, allBiz).length > 0 ? dedup(existing, allBiz) : MOCK_BUSINESSES;
      });
      setPageTokens(allTokens);
      setIsLive(allBiz.length > 0);
    } catch(e) {
      setError("שגיאה: " + e.message);
    } finally { setLoading(false); }
  };

  // מעקב איזו קטגוריה נוספת כבר נטענה
  const [extraCatIndex, setExtraCatIndex] = React.useState(0);

  const handleLoadMore = async () => {
    if (!apiKey.trim()) return;
    setLoadingMore(true);
    setError("");
    try {
      // בכל לחיצה — טוען קטגוריה אחת מהרשימה הנוספת בכל הערים
      const cat = ALL_CATS_EXTRA[extraCatIndex % ALL_CATS_EXTRA.length];
      const nextIndex = (extraCatIndex + 1) % ALL_CATS_EXTRA.length;

      const results = await Promise.allSettled(
        ALL_CITIES.map(city =>
          fetchRealBusinesses(apiKey.trim(), city, cat)
            .catch(() => ({ bizList:[], nextPageToken:null }))
        )
      );
      const newBiz = results.flatMap(r => r.status==="fulfilled" ? r.value.bizList : []);
      setBusinesses(prev => dedup(prev, newBiz));
      setExtraCatIndex(nextIndex);
      if (newBiz.length === 0) setError(`לא נמצאו לידים חדשים בקטגוריה זו`);
    } catch(e) {
      setError("שגיאה בטעינה נוספת: " + e.message);
    } finally { setLoadingMore(false); }
  };

  const getStatus = id => STATUS_MAP[leadStatus[id] || "new"];

  const filtered = businesses
    .filter(b => !b.hasWebsite)
    .filter(b => filterStatus === "all" || (leadStatus[b.id]||"new") === filterStatus)
    .filter(b => filterCat    === "all" || b.category === filterCat)
    .filter(b => filterPkg    === "all" || b.package === filterPkg)
    .filter(b => b.rating >= minRating)
    .filter(b => !searchName  || b.name.toLowerCase().includes(searchName.toLowerCase()) ||
                                 b.city.includes(searchName) ||
                                 b.categoryLabel.includes(searchName))
    .sort((a, b) => sortBy === "rating" ? b.rating - a.rating : b.reviews - a.reviews);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const setFilter = fn => { fn(); setPage(1); };

  const countStatus   = id => businesses.filter(b => (leadStatus[b.id]||"new") === id).length;
  const closedBizs    = businesses.filter(b => (leadStatus[b.id]||"new") === "closed");
  const closedRevenue = closedBizs.reduce((s,b) => s + calcDeal(b.id, b.packagePrice).sale,   0);
  const closedProfit  = closedBizs.reduce((s,b) => s + calcDeal(b.id, b.packagePrice).profit, 0);
  const totalFund     = closedBizs.reduce((s,b) => s + calcDeal(b.id, b.packagePrice).fund,   0);
  const totalWithdrawn = fundWithdrawals.reduce((s,w) => s + w.amount, 0);
  const fundBalance   = totalFund - totalWithdrawn;
  const netProfit     = closedProfit - CLAUDE_MONTHLY;

  // ממוצע רווח לשעה מכל העסקות הסגורות עם זמן מוגדר
  const avgRatePerHour = (() => {
    const withTime = closedBizs.filter(b => {
      const dd = dealData[b.id] || {};
      const totalMin = (parseFloat(dd.timeLead)||0)+(parseFloat(dd.timeDemo)||0)+(parseFloat(dd.timeFix)||0)+(parseFloat(dd.timeDeploy)||0);
      return totalMin > 0;
    });
    if (withTime.length === 0) return null;
    const totalProfit = withTime.reduce((s,b) => s + calcDeal(b.id, b.packagePrice).profit, 0);
    const totalHours  = withTime.reduce((s,b) => {
      const dd = dealData[b.id] || {};
      const min = (parseFloat(dd.timeLead)||0)+(parseFloat(dd.timeDemo)||0)+(parseFloat(dd.timeFix)||0)+(parseFloat(dd.timeDeploy)||0);
      return s + min/60;
    }, 0);
    return totalHours > 0 ? Math.round(totalProfit / totalHours) : null;
  })();

  return (
    <div dir="rtl" style={{
      minHeight:"100vh", overflowY:"auto", overflowX:"hidden",
      background:"radial-gradient(ellipse at 20% 0%, #0F1F35 0%, #070D18 70%)",
      fontFamily:"'Segoe UI','Arial Hebrew',sans-serif", color:"#F8FAFC",
      WebkitOverflowScrolling:"touch"
    }}>
      <style>{`
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
        .row-hover:hover{background:rgba(99,102,241,0.07)!important;}
        .pill{transition:all .15s;border:none;cursor:pointer;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-thumb{background:#2D3F55;border-radius:4px;}
        input::placeholder{color:#334155;}
        html, body { overflow-x: hidden; }
      `}</style>

      <div style={{ maxWidth:1060, margin:"0 auto", padding:"20px 14px" }}>

        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18 }}>
          <div style={{ width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#6366F1,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>🎯</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:20,fontWeight:900,letterSpacing:-0.5 }}>Lead Agent Pro</div>
            <div style={{ fontSize:11,color:"#334155" }}>מאגר לידים · פייפליין מכירות · הודעות ופרומפט</div>
          </div>
          <div style={{ display:"flex",gap:5,background:"rgba(255,255,255,0.05)",borderRadius:9,padding:3 }}>
            {[{id:"table",icon:"📋"},{id:"pipeline",icon:"🔄"}].map(v=>(
              <button key={v.id} onClick={()=>setView(v.id)} style={{
                padding:"6px 11px",borderRadius:6,border:"none",fontSize:12,fontWeight:700,
                background:view===v.id?"rgba(99,102,241,0.4)":"transparent",
                color:view===v.id?"#A5B4FC":"#475569",cursor:"pointer"
              }}>{v.icon} {v.id==="table"?"טבלה":"פייפליין"}</button>
            ))}
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:7, marginBottom:8 }}>
          {[
            { l:"סה״כ לידים", v:businesses.length, c:"#6366F1" },
            { l:"✅ הכנסה",   v:`₪${closedRevenue.toLocaleString()}`, c:"#4ADE80" },
            { l:"💰 רווח נקי",v:`₪${netProfit>0?netProfit.toLocaleString():0}`, c:netProfit>0?"#F59E0B":"#F87171" },
            { l:"⏱️ רווח/שעה (ממוצע)", v: avgRatePerHour ? `₪${avgRatePerHour.toLocaleString()}` : "—", c: avgRatePerHour>=200?"#4ADE80":avgRatePerHour>=100?"#FB923C":"#A78BFA" },
          ].map(s=>(
            <div key={s.l} style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:11,padding:"10px 8px",textAlign:"center" }}>
              <div style={{ fontSize:16,fontWeight:900,color:s.c,lineHeight:1.1 }}>{s.v}</div>
              <div style={{ fontSize:10,color:"#475569",marginTop:3 }}>{s.l}</div>
            </div>
          ))}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:7, marginBottom:10 }}>
          {[
            { l:"📤 הוק נשלח",  v:countStatus("sent1"),    c:"#818CF8" },
            { l:"🔗 דמו נשלח",  v:countStatus("sent2"),    c:"#38BDF8" },
            { l:"⏳ פולואו-אפ", v:countStatus("followup"), c:"#FB923C" },
          ].map(s=>(
            <div key={s.l} style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:11,padding:"8px",textAlign:"center" }}>
              <div style={{ fontSize:15,fontWeight:800,color:s.c }}>{s.v}</div>
              <div style={{ fontSize:10,color:"#334155",marginTop:2 }}>{s.l}</div>
            </div>
          ))}
        </div>

        <div style={{ background:"rgba(234,179,8,0.06)", border:"1px solid rgba(234,179,8,0.2)", borderRadius:14, marginBottom:12, overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 15px", cursor:"pointer" }} onClick={()=>setShowFund(p=>!p)}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:18 }}>🏦</span>
              <div>
                <div style={{ fontSize:13, fontWeight:800, color:"#FDE047" }}>קרן חירום</div>
                <div style={{ fontSize:11, color:"#78716C" }}>10% מכל עסקה · נצבר אוטומטית</div>
              </div>
            </div>
            <div style={{ textAlign:"left" }}>
              <div style={{ fontSize:20, fontWeight:900, color: fundBalance>0?"#FDE047":"#78716C" }}>₪{fundBalance.toLocaleString()}</div>
              <div style={{ fontSize:10, color:"#78716C" }}>נצבר: ₪{totalFund.toLocaleString()} · נמשך: ₪{totalWithdrawn.toLocaleString()}</div>
            </div>
            <span style={{ color:"#78716C", fontSize:14, marginRight:8 }}>{showFund?"▲":"▼"}</span>
          </div>

          {showFund && (
            <div style={{ padding:"0 15px 15px", borderTop:"1px solid rgba(234,179,8,0.15)" }}>
              <div style={{ marginTop:12, marginBottom:10 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#A78BFA", marginBottom:8 }}>💸 משיכת חירום</div>
                <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
                  <input type="number" value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)}
                    placeholder="סכום (₪)"
                    style={{ flex:"0 0 100px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"7px 10px", color:"#F1F5F9", fontSize:12, outline:"none" }}/>
                  <input type="text" value={withdrawNote} onChange={e=>setWithdrawNote(e.target.value)}
                    placeholder="סיבה (אופציונלי)"
                    style={{ flex:"1 1 140px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"7px 10px", color:"#F1F5F9", fontSize:12, outline:"none" }}/>
                  <button onClick={addWithdrawal} disabled={!withdrawAmount || fundBalance<=0} style={{
                    flex:"0 0 80px", background: fundBalance>0?"rgba(234,179,8,0.2)":"rgba(255,255,255,0.05)",
                    border:`1px solid ${fundBalance>0?"rgba(234,179,8,0.4)":"rgba(255,255,255,0.08)"}`,
                    color: fundBalance>0?"#FDE047":"#475569", borderRadius:8, padding:"7px 0",
                    fontSize:12, fontWeight:700, cursor:fundBalance>0?"pointer":"not-allowed"
                  }}>משוך</button>
                </div>
              </div>
              {fundWithdrawals.length > 0 && (
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:"#64748B", marginBottom:6 }}>היסטוריה</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:160, overflowY:"auto" }}>
                    {[...fundWithdrawals].reverse().map((w,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 10px", background:"rgba(255,255,255,0.03)", borderRadius:7 }}>
                        <div>
                          <span style={{ fontSize:12, color:"#CBD5E1" }}>{w.note}</span>
                          <span style={{ fontSize:10, color:"#475569", marginRight:8 }}>{w.date}</span>
                        </div>
                        <span style={{ fontSize:13, fontWeight:700, color:"#F87171" }}>- ₪{w.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {fundWithdrawals.length === 0 && (
                <div style={{ fontSize:11, color:"#44403C", textAlign:"center", padding:"8px 0" }}>אין משיכות עדיין — הקרן שלמה 💪</div>
              )}
            </div>
          )}
        </div>

        <div style={{ fontSize:11,color:"#334155",marginBottom:12 }}>
          📌 עלויות קבועות חודשיות: קלוד ₪{CLAUDE_MONTHLY} + Google API ₪{GOOGLE_API_MO} = ₪{TOTAL_FIXED} · מחולק ₪{FIXED_PER_DEAL} לעסקה · קרן חירום 10% מכל מכירה
        </div>

        <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"13px 15px",marginBottom:12 }}>
          <div style={{ fontSize:10,fontWeight:700,color:"#334155",textTransform:"uppercase",letterSpacing:1,marginBottom:9 }}>🔑 חיפוש לידים — כל הארץ, כל התחומים</div>
          <div style={{ display:"flex",gap:7,flexWrap:"wrap" }}>
            <div style={{ flex:"1 1 280px",position:"relative" }}>
              <input type={showKey?"text":"password"} value={apiKey} onChange={e=>setApiKey(e.target.value)}
                placeholder="Google Places API Key (ללא Key — דמו)"
                style={{ width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"8px 34px 8px 11px",color:"#F1F5F9",fontSize:12,outline:"none",boxSizing:"border-box" }}/>
              <button onClick={()=>setShowKey(p=>!p)} style={{ position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:12 }}>{showKey?"🙈":"👁️"}</button>
            </div>
            <button onClick={handleSearch} disabled={loading} style={{ flex:"0 0 160px",background:"linear-gradient(135deg,#6366F1,#8B5CF6)",color:"#fff",border:"none",borderRadius:9,padding:"8px 0",fontWeight:800,fontSize:12,cursor:loading?"wait":"pointer",opacity:loading?0.7:1 }}>
              {loading ? "⏳ מחפש..." : isLive ? "🔄 הוסף לידים חדשים" : apiKey ? "🔍 Live — כל הארץ" : "▶ דמו"}
            </button>
            {isLive && (
              <button onClick={()=>{ if(window.confirm("למחוק את כל הלידים ולהתחיל מחדש?")) { setBusinesses([]); setIsLive(false); setPageTokens([]); }}} style={{ flex:"0 0 90px",background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",color:"#F87171",borderRadius:9,padding:"8px 0",fontWeight:700,fontSize:11,cursor:"pointer" }}>
                🗑️ נקה הכל
              </button>
            )}
          </div>
          <div style={{ display:"flex",gap:8,alignItems:"center",marginTop:8 }}>
            <span style={{ fontSize:10,padding:"2px 8px",borderRadius:16,fontWeight:700, background:isLive?"#052e16":"rgba(99,102,241,0.1)", color:isLive?"#34D399":"#818CF8" }}>{isLive?"● Live":"◎ דמו"}</span>
            {error && <span style={{ fontSize:10,color:"#F87171" }}>⚠️ {error}</span>}
            <span style={{ fontSize:10,color:"#475569",marginRight:"auto" }}>{businesses.length} עסקים במאגר · {loading?"מחפש...":"ללא אתר בלבד"}</span>
            {isLive && (
              <button onClick={handleLoadMore} disabled={loadingMore} style={{
                background:"rgba(52,211,153,0.15)", border:"1px solid rgba(52,211,153,0.3)",
                color:"#34D399", borderRadius:8, padding:"4px 12px",
                fontSize:11, fontWeight:700, cursor:loadingMore?"wait":"pointer"
              }}>
                {loadingMore ? "⏳ טוען..." : "➕ טען עוד לידים"}
              </button>
            )}
          </div>
        </div>

        <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"11px 13px",marginBottom:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center" }}>
          <div style={{ position:"relative",flex:"1 1 180px" }}>
            <span style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#334155" }}>🔍</span>
            <input value={searchName} onChange={e=>{setSearchName(e.target.value);setPage(1);}}
              placeholder="חיפוש לפי שם / עיר / קטגוריה..."
              style={{ width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:8,padding:"7px 30px 7px 11px",color:"#F1F5F9",fontSize:12,outline:"none",boxSizing:"border-box" }}/>
          </div>
          <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
            <button className="pill" onClick={()=>setFilter(()=>setFilterStatus("all"))} style={{ padding:"5px 10px",borderRadius:16,fontSize:11,fontWeight:700,background:filterStatus==="all"?"rgba(99,102,241,0.25)":"rgba(255,255,255,0.04)",color:filterStatus==="all"?"#A5B4FC":"#475569",border:`1.5px solid ${filterStatus==="all"?"#6366F1":"rgba(255,255,255,0.06)"}` }}>
              הכל ({filtered.length})
            </button>
            {STATUSES.map(s=>{
              const cnt = businesses.filter(b=>(leadStatus[b.id]||"new")===s.id).length;
              return (
                <button key={s.id} className="pill" onClick={()=>setFilter(()=>setFilterStatus(s.id))} style={{
                  padding:"5px 10px",borderRadius:16,fontSize:11,fontWeight:700,
                  background:filterStatus===s.id?s.bg:"rgba(255,255,255,0.03)",
                  color:filterStatus===s.id?s.color:"#475569",
                  border:`1.5px solid ${filterStatus===s.id?s.color+"55":"rgba(255,255,255,0.05)"}`
                }}>{s.label} {cnt>0&&<span style={{opacity:0.8}}>({cnt})</span>}</button>
              );
            })}
          </div>
          <div style={{ display:"flex",gap:6,marginRight:"auto",flexWrap:"wrap" }}>
            <select value={filterPkg} onChange={e=>{setFilterPkg(e.target.value);setPage(1);}} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"5px 9px",color:"#94A3B8",fontSize:11 }}>
              <option value="all"    style={{background:"#0C1420"}}>📦 כל החבילות</option>
              <option value="בייסיק"  style={{background:"#0C1420"}}>🥉 בייסיק — ₪890</option>
              <option value="סטנדרט" style={{background:"#0C1420"}}>🥈 סטנדרט — ₪1,690</option>
              <option value="פרימיום" style={{background:"#0C1420"}}>🥇 פרימיום — ₪2,890</option>
            </select>
            <select value={filterCat} onChange={e=>{setFilterCat(e.target.value);setPage(1);}} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"5px 9px",color:"#94A3B8",fontSize:11 }}>
              <option value="all" style={{background:"#0C1420"}}>📂 הכל</option>
              {CATS.map(c=><option key={c.id} value={c.id} style={{background:"#0C1420"}}>{c.label}</option>)}
            </select>
            <select value={minRating} onChange={e=>{setMinRating(Number(e.target.value));setPage(1);}} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"5px 9px",color:"#94A3B8",fontSize:11 }}>
              <option value={0} style={{background:"#0C1420"}}>⭐ כל הדירוגים</option>
              <option value={4} style={{background:"#0C1420"}}>⭐ 4.0+</option>
              <option value={4.5} style={{background:"#0C1420"}}>⭐ 4.5+</option>
            </select>
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"5px 9px",color:"#94A3B8",fontSize:11 }}>
              <option value="rating"  style={{background:"#0C1420"}}>↓ דירוג</option>
              <option value="reviews" style={{background:"#0C1420"}}>↓ ביקורות</option>
            </select>
          </div>
        </div>

        {view === "pipeline" && (
          <div style={{ overflowX:"auto",paddingBottom:8 }}>
            <div style={{ display:"flex",gap:10,minWidth:760 }}>
              {STATUSES.map(s => {
                const biz = businesses.filter(b => (leadStatus[b.id]||"new") === s.id);
                return (
                  <div key={s.id} style={{ flex:"1 0 155px",background:"rgba(255,255,255,0.025)",border:`1px solid ${s.color}25`,borderRadius:12,padding:"10px 10px 12px",minHeight:160 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                      <span style={{ fontSize:11,fontWeight:800,color:s.color }}>{s.label}</span>
                      <span style={{ fontSize:11,background:s.bg,color:s.color,borderRadius:10,padding:"1px 7px",fontWeight:700 }}>{biz.length}</span>
                    </div>
                    <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                      {biz.map(b=>(
                        <div key={b.id} onClick={()=>setOpen(b)} style={{
                          background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"7px 9px",
                          cursor:"pointer",border:"1px solid rgba(255,255,255,0.05)",
                          transition:"background 0.12s"
                        }}>
                          <div style={{ fontSize:12,fontWeight:600,color:"#E2E8F0",lineHeight:1.3 }}>{b.name}</div>
                          <div style={{ fontSize:10,color:"#475569",marginTop:3,display:"flex",justifyContent:"space-between" }}>
                            <span>{b.city}</span><span style={{color:"#64748B"}}>{b.packagePrice}</span>
                          </div>
                        </div>
                      ))}
                      {biz.length===0 && <div style={{ fontSize:11,color:"#1E293B",textAlign:"center",paddingTop:16 }}>ריק</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === "table" && (
          <>
            <div style={{ fontSize:11,color:"#334155",marginBottom:7,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <span>מציג {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE,filtered.length)} מתוך {filtered.length} לידים
                {searchName && <span style={{color:"#6366F1",marginRight:6}}>· "{searchName}"</span>}
              </span>
              <button onClick={exportCSV} style={{ background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",color:"#818CF8",borderRadius:8,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer" }}>
                📥 ייצוא CSV
              </button>
            </div>

            <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,overflow:"visible" }}>
              <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr 0.7fr 0.8fr 1.2fr 0.6fr",padding:"8px 14px",background:"rgba(99,102,241,0.08)",borderRadius:"14px 14px 0 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:0.8 }}>
                <span>שם עסק</span><span>קטגוריה / עיר</span><span>דירוג</span><span>מחיר</span><span>סטטוס</span><span>פרטים</span>
              </div>

              {paginated.length === 0 && (
                <div style={{ padding:40,textAlign:"center",color:"#334155" }}>
                  <div style={{ fontSize:32 }}>🔍</div>
                  <div style={{ marginTop:8,fontSize:13 }}>{searchName ? `אין תוצאות עבור "${searchName}"` : "אין לידים בסטטוס זה"}</div>
                </div>
              )}

              {paginated.map((biz,i)=>{
                const p          = PKG[biz.package];
                const isClosed   = (leadStatus[biz.id]||"new") === "closed";
                const days       = daysSince(biz.id);
                const needFollowup = days !== null && days >= 2 &&
                  ["sent1","sent2"].includes(leadStatus[biz.id]||"new");
                return (
                  <div key={biz.id} className="row-hover" style={{
                    display:"grid",gridTemplateColumns:"2fr 1fr 0.7fr 0.8fr 1.2fr 0.6fr",
                    padding:"10px 14px",alignItems:"center",cursor:"default",
                    borderBottom:i<paginated.length-1?"1px solid rgba(255,255,255,0.04)":"none",
                    background: needFollowup ? "rgba(251,146,60,0.04)" : isClosed ? "rgba(74,222,128,0.03)" : "transparent",
                    transition:"background 0.12s"
                  }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8,cursor:"pointer" }} onClick={()=>setOpen(biz)}>
                      <div style={{ width:28,height:28,borderRadius:7,flexShrink:0,
                        background:`linear-gradient(135deg,${biz.dominantColors[0]},${biz.dominantColors[1]||"#555"})`,
                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff" }}>
                        {biz.name[0]}
                      </div>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:13,fontWeight:600,
                          color:isClosed?"#4ADE80":needFollowup?"#FB923C":"#E2E8F0",
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                          {needFollowup && <span style={{ marginLeft:4 }}>🔔</span>}
                          {biz.name}
                        </div>
                        <div style={{ display:"flex",gap:4,marginTop:2,flexWrap:"wrap" }}>
                          <span style={{ fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:4,background:p.bg,color:p.text }}>{p.label}</span>
                          {days !== null && (
                            <span style={{ fontSize:9,padding:"1px 5px",borderRadius:4,fontWeight:700,
                              background: needFollowup?"rgba(251,146,60,0.2)":"rgba(255,255,255,0.06)",
                              color: needFollowup?"#FB923C":"#475569" }}>
                              {days === 0 ? "היום" : `לפני ${days} ימים`}
                            </span>
                          )}
                          {(() => {
                            const dd = dealData[biz.id] || {};
                            const fp = dd.firstPaid === "true";
                            const sp = dd.secondPaid === "true";
                            if (!fp && !sp) return null;
                            return (
                              <span style={{ fontSize:9,padding:"1px 5px",borderRadius:4,fontWeight:700,
                                background: fp&&sp?"rgba(74,222,128,0.2)":"rgba(251,146,60,0.2)",
                                color: fp&&sp?"#4ADE80":"#FB923C" }}>
                                {fp&&sp ? "💳 שולם הכל" : "💳 חצי שולם"}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    <div onClick={()=>setOpen(biz)} style={{ cursor:"pointer" }}>
                      <div style={{ fontSize:11,color:"#64748B" }}>{biz.categoryLabel}</div>
                      <div style={{ fontSize:10,color:"#334155",marginTop:1 }}>{biz.city}</div>
                    </div>
                    <span style={{ fontSize:12,color:"#FBBF24",fontWeight:700 }}>⭐ {biz.rating}</span>
                    <span style={{ fontSize:11,color:"#94A3B8",fontWeight:600 }}>{biz.packagePrice}</span>
                    <StatusDropdown bizId={biz.id} leadStatus={leadStatus} setStatusWithDate={setStatusWithDate} />
                    <button onClick={()=>setOpen(biz)} style={{ background:"rgba(99,102,241,0.14)",border:"1px solid rgba(99,102,241,0.28)",color:"#818CF8",borderRadius:7,padding:"4px 7px",fontSize:11,fontWeight:700,cursor:"pointer" }}>←</button>
                  </div>
                );
              })}
            </div>

            {showCSV && (
              <div style={{ marginTop:10, background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:12, padding:"13px 15px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:"#A5B4FC" }}>📋 נתוני CSV — העתק לאקסל / Google Sheets</span>
                  <div style={{ display:"flex", gap:7 }}>
                    <button onClick={copyCSV} style={{ background: csvCopied?"#059669":"rgba(99,102,241,0.25)", border:"none", borderRadius:7, padding:"5px 11px", color: csvCopied?"#fff":"#A5B4FC", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                      {csvCopied ? "✅ הועתק!" : "📋 העתק"}
                    </button>
                    <button onClick={()=>setShowCSV(false)} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:7, padding:"5px 10px", color:"#475569", fontSize:11, cursor:"pointer" }}>✕</button>
                  </div>
                </div>
                <textarea readOnly value={generateCSV()}
                  style={{ width:"100%", height:160, background:"rgba(0,0,0,0.3)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:"10px", color:"#64748B", fontSize:10, fontFamily:"monospace", resize:"vertical", boxSizing:"border-box", outline:"none" }}/>
                <div style={{ fontSize:10, color:"#334155", marginTop:5 }}>פתח Google Sheets ← קובץ ← ייבוא ← הדבק</div>
              </div>
            )}

            {totalPages > 1 && (
              <div style={{ display:"flex",justifyContent:"center",alignItems:"center",gap:6,marginTop:12 }}>
                <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                  style={{ background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:page===1?"#334155":"#94A3B8",borderRadius:8,padding:"6px 12px",fontSize:12,cursor:page===1?"default":"pointer" }}>← הקודם</button>
                {Array.from({length:Math.min(7,totalPages)},(_,i)=>{
                  const p = totalPages<=7 ? i+1 : page<=4 ? i+1 : page>=totalPages-3 ? totalPages-6+i : page-3+i;
                  return (
                    <button key={p} onClick={()=>setPage(p)} style={{ width:32,height:32,borderRadius:7,border:"none",fontSize:12,fontWeight:700,background:page===p?"rgba(99,102,241,0.4)":"rgba(255,255,255,0.04)",color:page===p?"#A5B4FC":"#475569",cursor:"pointer" }}>{p}</button>
                  );
                })}
                <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                  style={{ background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",color:page===totalPages?"#334155":"#94A3B8",borderRadius:8,padding:"6px 12px",fontSize:12,cursor:page===totalPages?"default":"pointer" }}>הבא →</button>
                <span style={{ fontSize:11,color:"#334155",marginRight:4 }}>עמוד {page} מתוך {totalPages}</span>
              </div>
            )}
          </>
        )}
      </div>

      {open && <Modal biz={open} onClose={()=>setOpen(null)}
        dealData={dealData} updateDeal={updateDeal} calcDeal={calcDeal}
        isClosed={(leadStatus[open?.id]||"new")==="closed"} />}
    </div>
  );
}

export default App;
