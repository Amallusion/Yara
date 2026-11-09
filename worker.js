/*
 * Yara chat: a Cloudflare Worker that answers like the Dify app did, without Dify.
 *
 *   1. Finds the most relevant sections of Yara's five knowledge files (they are built into this file).
 *   2. For price questions, reads data/prices.csv live from the website (same rules as the old CODE node).
 *   3. Asks a Workers AI model, with Yara's prompt, and streams the answer back.
 *
 * Settings (Worker → Settings → Variables), all optional:
 *   MODEL            the Workers AI model. Default below.
 *   ALLOWED_ORIGINS  comma-separated sites allowed to call this Worker. Default below.
 *   PRICES_URL       where the price list lives. Default below.
 * Binding (Worker → Settings → Bindings): Workers AI, variable name AI. Required.
 *
 * Chats are not stored anywhere.
 * Built by tools/build_worker.py on 2026-11-09 from the files in knowledge/.
 */

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEFAULT_ORIGINS = 'https://amallusion.github.io,http://localhost:8080,http://127.0.0.1:8080';
const DEFAULT_PRICES_URL = 'https://amallusion.github.io/yara/data/prices.csv';
const MAX_MESSAGE = 1000;   // characters in one user message
const HISTORY_TURNS = 3;    // earlier user+assistant pairs sent to the model (like Memory window 3)
const TOP_K = 6;            // knowledge sections per answer (like Top K 6)
const CONTEXT_CHARS = 10000;
const SECTION_CHARS = 2600;

const KNOWLEDGE = [
{
"file": "yara-recipe-index.md",
"title": "All Yara vegan recipes | كل وصفات يارا النباتية",
"text": "This is the list of vegan recipes on the Yara website. Use it for general requests such as: give me vegan recipes, recipe ideas, what can I cook, suggest a meal, plant-based dishes, وصفات نباتية، اقترح علي وصفة، وش أطبخ، أكلات نباتية. Copy recipe names exactly as written here.\n\n1. Lentil kabsa | كبسة العدس (lunch or dinner, 35 min, about 16 g protein per serving)\n2. Chickpea kabsa bowl | طبق الحمص بنكهة الكبسة (lunch or dinner, 25 min, about 16 g protein per serving)\n3. Foul with tahini and herbs | فول بالطحينة والأعشاب (breakfast, 15 min, about 22 g protein per serving)\n4. Mujaddara with cucumber salad | مجدرة مع سلطة الخيار (lunch or dinner, 45 min, about 17 g protein per serving)\n5. Date and tahini overnight oats | شوفان منقوع بالتمر والطحينة (breakfast, 5 min, about 11 g protein per serving)\n6. Roasted vegetable tahini wrap | لفائف الخضار المشوية بالطحينة (lunch, 30 min, about 15 g protein per serving)\n7. Peanut butter and date toast | خبز محمص بزبدة الفول السوداني والتمر (breakfast or snack, 5 min, about 16 g protein per serving)\n8. Freekeh with chickpeas and parsley | فريكة بالحمص والبقدونس (lunch or dinner, 40 min, about 12 g protein per serving)\n9. Smooth hummus | حمص بالطحينة (snack, 10 min, about 5 g protein per serving)\n10. Crunchy roasted chickpeas | حمص محمص مقرمش (snack, 40 min, about 5 g protein per serving)\n11. Lentil vegetable soup | شوربة العدس بالخضار (lunch or dinner, 60 min, about 9 g protein per serving)\n12. Spiced lentil wraps | لفائف العدس المتبّل (lunch or dinner, 45 min, about 14 g protein per serving)\n13. Garden white bean salad | سلطة الفاصوليا البيضاء بالخضار (lunch, 20 min, about 20 g protein per serving)\n14. Chickpeas and spinach sauté | حمص مع السبانخ (dinner, 35 min, about 10 g protein per serving)\n15. Red beans and rice | فاصوليا حمراء مع الأرز (lunch or dinner, 45 min, about 18 g protein per serving)"
},
{
"file": "yara-recipe-index.md",
"title": "Yara vegan breakfast recipes | وصفات فطور نباتية من يارا",
"text": "Vegan breakfast ideas from Yara's recipes:\n- Foul with tahini and herbs | فول بالطحينة والأعشاب (breakfast, 15 min, about 22 g protein per serving)\n- Date and tahini overnight oats | شوفان منقوع بالتمر والطحينة (breakfast, 5 min, about 11 g protein per serving)\n- Peanut butter and date toast | خبز محمص بزبدة الفول السوداني والتمر (breakfast or snack, 5 min, about 16 g protein per serving)"
},
{
"file": "yara-recipe-index.md",
"title": "Yara vegan lunch and dinner recipes | وصفات غداء وعشاء نباتية من يارا",
"text": "Vegan lunch and dinner ideas from Yara's recipes:\n- Lentil kabsa | كبسة العدس (lunch or dinner, 35 min, about 16 g protein per serving)\n- Chickpea kabsa bowl | طبق الحمص بنكهة الكبسة (lunch or dinner, 25 min, about 16 g protein per serving)\n- Mujaddara with cucumber salad | مجدرة مع سلطة الخيار (lunch or dinner, 45 min, about 17 g protein per serving)\n- Roasted vegetable tahini wrap | لفائف الخضار المشوية بالطحينة (lunch, 30 min, about 15 g protein per serving)\n- Freekeh with chickpeas and parsley | فريكة بالحمص والبقدونس (lunch or dinner, 40 min, about 12 g protein per serving)\n- Lentil vegetable soup | شوربة العدس بالخضار (lunch or dinner, 60 min, about 9 g protein per serving)\n- Spiced lentil wraps | لفائف العدس المتبّل (lunch or dinner, 45 min, about 14 g protein per serving)\n- Garden white bean salad | سلطة الفاصوليا البيضاء بالخضار (lunch, 20 min, about 20 g protein per serving)\n- Chickpeas and spinach sauté | حمص مع السبانخ (dinner, 35 min, about 10 g protein per serving)\n- Red beans and rice | فاصوليا حمراء مع الأرز (lunch or dinner, 45 min, about 18 g protein per serving)"
},
{
"file": "yara-recipe-index.md",
"title": "Yara vegan snack recipes | وجبات خفيفة نباتية من يارا",
"text": "Vegan snack ideas from Yara's recipes:\n- Peanut butter and date toast | خبز محمص بزبدة الفول السوداني والتمر (breakfast or snack, 5 min, about 16 g protein per serving)\n- Smooth hummus | حمص بالطحينة (snack, 10 min, about 5 g protein per serving)\n- Crunchy roasted chickpeas | حمص محمص مقرمش (snack, 40 min, about 5 g protein per serving)"
},
{
"file": "yara-recipe-index.md",
"title": "Yara high-protein vegan recipes | وصفات يارا النباتية الغنية بالبروتين",
"text": "Yara recipes with 15 g of protein or more per serving:\n- Foul with tahini and herbs | فول بالطحينة والأعشاب (breakfast, 15 min, about 22 g protein per serving)\n- Garden white bean salad | سلطة الفاصوليا البيضاء بالخضار (lunch, 20 min, about 20 g protein per serving)\n- Red beans and rice | فاصوليا حمراء مع الأرز (lunch or dinner, 45 min, about 18 g protein per serving)\n- Mujaddara with cucumber salad | مجدرة مع سلطة الخيار (lunch or dinner, 45 min, about 17 g protein per serving)\n- Lentil kabsa | كبسة العدس (lunch or dinner, 35 min, about 16 g protein per serving)\n- Peanut butter and date toast | خبز محمص بزبدة الفول السوداني والتمر (breakfast or snack, 5 min, about 16 g protein per serving)\n- Chickpea kabsa bowl | طبق الحمص بنكهة الكبسة (lunch or dinner, 25 min, about 16 g protein per serving)\n- Roasted vegetable tahini wrap | لفائف الخضار المشوية بالطحينة (lunch, 30 min, about 15 g protein per serving)"
},
{
"file": "yara-recipe-index.md",
"title": "Yara quick vegan recipes | وصفات يارا النباتية السريعة",
"text": "Yara recipes ready in 30 minutes or less:\n- Date and tahini overnight oats | شوفان منقوع بالتمر والطحينة (breakfast, 5 min, about 11 g protein per serving)\n- Peanut butter and date toast | خبز محمص بزبدة الفول السوداني والتمر (breakfast or snack, 5 min, about 16 g protein per serving)\n- Smooth hummus | حمص بالطحينة (snack, 10 min, about 5 g protein per serving)\n- Foul with tahini and herbs | فول بالطحينة والأعشاب (breakfast, 15 min, about 22 g protein per serving)\n- Garden white bean salad | سلطة الفاصوليا البيضاء بالخضار (lunch, 20 min, about 20 g protein per serving)\n- Chickpea kabsa bowl | طبق الحمص بنكهة الكبسة (lunch or dinner, 25 min, about 16 g protein per serving)\n- Roasted vegetable tahini wrap | لفائف الخضار المشوية بالطحينة (lunch, 30 min, about 15 g protein per serving)"
},
{
"file": "yara-recipes.md",
"title": "About Yara's recipes | عن وصفات يارا",
"text": "Every recipe on the Yara website, in English and Arabic. All of them are vegan. Each recipe appears twice: once in English and once in Arabic. Ingredient prices come from Yara's live price list, and the website shows each recipe's cost per serving.\nRecipes adapted from the USDA use the original recipe's published nutrition panel; Yara's own recipes use an estimate from the ingredients. Five recipes are adapted from the U.S. Department of Agriculture's MyPlate Kitchen (public domain), via MyPlate.food; mention the original source when you share one of them."
},
{
"file": "yara-recipes.md",
"title": "Yara recipes at a glance | وصفات يارا في لمحة",
"text": "| Recipe | الوصفة | Meal | Minutes | Serves | Protein per serving (g) |\n|---|---|---|---|---|---|\n| Foul with tahini and herbs | فول بالطحينة والأعشاب | Breakfast | 15 | 2 | 21.5 |\n| Garden white bean salad | سلطة الفاصوليا البيضاء بالخضار | Lunch | 20 | 4 | 20.2 |\n| Red beans and rice | فاصوليا حمراء مع الأرز | Lunch or Dinner | 45 | 4 | 17.5 |\n| Mujaddara with cucumber salad | مجدرة مع سلطة الخيار | Lunch or Dinner | 45 | 4 | 17.2 |\n| Lentil kabsa | كبسة العدس | Lunch or Dinner | 35 | 4 | 16.2 |\n| Peanut butter and date toast | خبز محمص بزبدة الفول السوداني والتمر | Breakfast or Snack | 5 | 1 | 15.7 |\n| Chickpea kabsa bowl | طبق الحمص بنكهة الكبسة | Lunch or Dinner | 25 | 2 | 15.6 |\n| Roasted vegetable tahini wrap | لفائف الخضار المشوية بالطحينة | Lunch | 30 | 2 | 15.3 |\n| Spiced lentil wraps | لفائف العدس المتبّل | Lunch or Dinner | 45 | 6 | 14.2 |\n| Freekeh with chickpeas and parsley | فريكة بالحمص والبقدونس | Lunch or Dinner | 40 | 4 | 11.8 |\n| Date and tahini overnight oats | شوفان منقوع بالتمر والطحينة | Breakfast | 5 | 1 | 10.6 |\n| Chickpeas and spinach sauté | حمص مع السبانخ | Dinner | 35 | 4 | 9.7 |\n| Lentil vegetable soup | شوربة العدس بالخضار | Lunch or Dinner | 60 | 6 | 9 |\n| Crunchy roasted chickpeas | حمص محمص مقرمش | Snack | 40 | 4 | 4.8 |\n| Smooth hummus | حمص بالطحينة | Snack | 10 | 6 | 4.7 |"
},
{
"file": "yara-recipes.md",
"title": "Yara 7-day vegan meal plan | خطة يارا النباتية لسبعة أيام",
"text": "Every meal is one of Yara's recipes. On average the week gives 53 g of protein a day (49 to 58 g). The website shows what it costs at today's prices.\nLunches marked leftovers reuse a dish cooked earlier in the week.\n- Day 1 (52 g protein): Breakfast: Foul with tahini and herbs; Lunch: Lentil kabsa; Dinner: Chickpeas and spinach sauté; Snack: Smooth hummus\n- Day 2 (49 g protein): Breakfast: Date and tahini overnight oats; Lunch: Lentil kabsa (leftovers); Dinner: Red beans and rice; Snack: Crunchy roasted chickpeas\n- Day 3 (58 g protein): Breakfast: Peanut butter and date toast; Lunch: Garden white bean salad; Dinner: Mujaddara with cucumber salad; Snack: Smooth hummus\n- Day 4 (58 g protein): Breakfast: Foul with tahini and herbs; Lunch: Mujaddara with cucumber salad (leftovers); Dinner: Spiced lentil wraps; Snack: Crunchy roasted chickpeas\n- Day 5 (56 g protein): Breakfast: Date and tahini overnight oats; Lunch: Red beans and rice (leftovers); Dinner: Freekeh with chickpeas and parsley; Snack: Peanut butter and date toast\n- Day 6 (50 g protein): Breakfast: Peanut butter and date toast; Lunch: Spiced lentil wraps (leftovers); Dinner: Chickpea kabsa bowl; Snack: Crunchy roasted chickpeas\n- Day 7 (50 g protein): Breakfast: Foul with tahini and herbs; Lunch: Lentil vegetable soup; Dinner: Roasted vegetable tahini wrap; Snack: Smooth hummus"
},
{
"file": "yara-recipes.md",
"title": "Recipe: Lentil kabsa | كبسة العدس",
"text": "Yara vegan recipe: Lentil kabsa (Arabic name: كبسة العدس). Meal: Lunch or Dinner. Time: 35 minutes. Serves 4.\nProtein: about 16.2 g per serving (estimated from the ingredients).\nAbout: Warm spiced lentils and rice with tomato, lemon, and fresh herbs.\n\nIngredients for lentil kabsa:\n- 1 cup brown lentils (about 190 g)\n- 1 cup basmati rice (about 185 g)\n- About 2 cups water\n- 2 tbsp vegetable oil\n- 1 onion, sliced\n- 2 tomatoes, chopped\n- 1 tbsp kabsa spice, 1 tsp cumin, lemon, and fresh coriander\n\nMethod for lentil kabsa:\n1. Cook the lentils until tender, then drain.\n2. Brown the onion in the oil with the spices, then add the tomatoes.\n3. Add the rice, lentils, and water. Cover and simmer until the rice is tender.\n4. Finish with lemon and coriander.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: كبسة العدس | Recipe in Arabic: Lentil kabsa",
"text": "وصفة نباتية من يارا: كبسة العدس (Lentil kabsa). الوجبة: غداء أو عشاء. مدة التحضير: 35 دقيقة. عدد الحصص: 4.\nالبروتين: نحو 16.2 جم للحصة (تقدير من المكونات).\nنبذة: عدس وأرز بتوابل الكبسة مع الطماطم والليمون والأعشاب الطازجة.\n\nمكونات كبسة العدس:\n- كوب عدس بني (نحو 190 جم)\n- كوب أرز بسمتي (نحو 185 جم)\n- نحو كوبين من الماء\n- ملعقتان كبيرتان زيت نباتي\n- بصلة مقطعة شرائح\n- حبتا طماطم مقطعتان\n- ملعقة كبيرة بهارات كبسة، وملعقة صغيرة كمون، وليمون، وكزبرة خضراء\n\nطريقة تحضير كبسة العدس:\n1. اسلق العدس حتى ينضج ثم صفّه.\n2. حمّر البصل في الزيت مع البهارات ثم أضف الطماطم.\n3. أضف الأرز والعدس والماء، ثم غطِّ القدر واتركه على نار هادئة حتى ينضج الأرز.\n4. قدّمه مع الليمون والكزبرة.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Chickpea kabsa bowl | طبق الحمص بنكهة الكبسة",
"text": "Yara vegan recipe: Chickpea kabsa bowl (Arabic name: طبق الحمص بنكهة الكبسة). Meal: Lunch or Dinner. Time: 25 minutes. Serves 2.\nProtein: about 15.6 g per serving (estimated from the ingredients).\nAbout: A fast pantry bowl for nights when you want something filling without a long shopping list.\n\nIngredients for chickpea kabsa bowl:\n- 1 can chickpeas (about 380 g), rinsed\n- 1 cup cooked rice\n- 1 bell pepper, sliced\n- 1 tbsp vegetable oil\n- 1 tbsp tomato paste and 1 tsp kabsa spice\n- Tahini-lemon sauce: 2 tbsp tahini, juice of half a lemon, a little water\n\nMethod for chickpea kabsa bowl:\n1. Sauté the pepper in the oil with the tomato paste and spices.\n2. Fold in the chickpeas and warm through.\n3. Whisk the tahini with lemon and water until smooth.\n4. Serve over rice with the tahini-lemon sauce.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: طبق الحمص بنكهة الكبسة | Recipe in Arabic: Chickpea kabsa bowl",
"text": "وصفة نباتية من يارا: طبق الحمص بنكهة الكبسة (Chickpea kabsa bowl). الوجبة: غداء أو عشاء. مدة التحضير: 25 دقيقة. عدد الحصص: 2.\nالبروتين: نحو 15.6 جم للحصة (تقدير من المكونات).\nنبذة: طبق سريع من مكونات المطبخ، للأيام التي تريد فيها وجبة مشبعة دون قائمة تسوق طويلة.\n\nمكونات طبق الحمص بنكهة الكبسة:\n- علبة حمص (نحو 380 جم) مصفّاة ومغسولة\n- كوب أرز مطبوخ\n- حبة فلفل رومي مقطعة شرائح\n- ملعقة كبيرة زيت نباتي\n- ملعقة كبيرة معجون طماطم وملعقة صغيرة بهارات كبسة\n- صلصة الطحينة: ملعقتان كبيرتان طحينة، وعصير نصف ليمونة، وقليل من الماء\n\nطريقة تحضير طبق الحمص بنكهة الكبسة:\n1. قلّب الفلفل في الزيت مع معجون الطماطم والبهارات.\n2. أضف الحمص وقلّبه حتى يسخن.\n3. اخفق الطحينة مع الليمون والماء حتى تصبح ناعمة.\n4. قدّمه فوق الأرز مع صلصة الطحينة بالليمون.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Foul with tahini and herbs | فول بالطحينة والأعشاب",
"text": "Yara vegan recipe: Foul with tahini and herbs (Arabic name: فول بالطحينة والأعشاب). Meal: Breakfast. Time: 15 minutes. Serves 2.\nProtein: about 21.5 g per serving (estimated from the ingredients).\nAbout: A simple breakfast or light dinner with lemon, cumin, and a creamy tahini finish.\n\nIngredients for foul with tahini and herbs:\n- 1 can foul medames (about 400 g)\n- 1 garlic clove, crushed\n- Lemon juice and cumin\n- 1 tbsp tahini\n- Tomato, parsley, and 2 Arabic breads\n\nMethod for foul with tahini and herbs:\n1. Warm the foul with the garlic, lemon, and cumin.\n2. Mash lightly, keeping some texture.\n3. Top with tahini, tomato, and parsley, and serve with the bread.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: فول بالطحينة والأعشاب | Recipe in Arabic: Foul with tahini and herbs",
"text": "وصفة نباتية من يارا: فول بالطحينة والأعشاب (Foul with tahini and herbs). الوجبة: فطور. مدة التحضير: 15 دقيقة. عدد الحصص: 2.\nالبروتين: نحو 21.5 جم للحصة (تقدير من المكونات).\nنبذة: فطور بسيط أو عشاء خفيف بالليمون والكمون، مع لمسة كريمية من الطحينة.\n\nمكونات فول بالطحينة والأعشاب:\n- علبة فول مدمس (نحو 400 جم)\n- فص ثوم مهروس\n- عصير ليمون وكمون\n- ملعقة كبيرة طحينة\n- طماطم وبقدونس ورغيفا خبز عربي\n\nطريقة تحضير فول بالطحينة والأعشاب:\n1. سخّن الفول مع الثوم والليمون والكمون.\n2. اهرسه قليلًا مع ترك بعض القوام.\n3. زيّنه بالطحينة والطماطم والبقدونس، وقدّمه مع الخبز.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Mujaddara with cucumber salad | مجدرة مع سلطة الخيار",
"text": "Yara vegan recipe: Mujaddara with cucumber salad (Arabic name: مجدرة مع سلطة الخيار). Meal: Lunch or Dinner. Time: 45 minutes. Serves 4.\nProtein: about 17.2 g per serving (estimated from the ingredients).\nAbout: Lentils, rice, and caramelized onion with a bright cucumber and mint salad.\n\nIngredients for mujaddara with cucumber salad:\n- 1 cup green or brown lentils\n- 1 cup rice\n- About 2 cups water\n- 3 onions, thinly sliced\n- 3 tbsp olive oil, cumin, and black pepper\n- Cucumber, mint, and lemon for the salad\n\nMethod for mujaddara with cucumber salad:\n1. Cook the lentils until nearly tender.\n2. Caramelize the onions slowly in olive oil until deep golden.\n3. Add the rice, lentils, spices, and water. Cover and simmer until the rice is tender.\n4. Top with the onions and serve with the cucumber-mint salad.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: مجدرة مع سلطة الخيار | Recipe in Arabic: Mujaddara with cucumber salad",
"text": "وصفة نباتية من يارا: مجدرة مع سلطة الخيار (Mujaddara with cucumber salad). الوجبة: غداء أو عشاء. مدة التحضير: 45 دقيقة. عدد الحصص: 4.\nالبروتين: نحو 17.2 جم للحصة (تقدير من المكونات).\nنبذة: عدس وأرز مع بصل مكرمل، وسلطة خيار منعشة بالنعناع.\n\nمكونات مجدرة مع سلطة الخيار:\n- كوب عدس أخضر أو بني\n- كوب أرز\n- نحو كوبين من الماء\n- 3 بصلات مقطعة شرائح رفيعة\n- 3 ملاعق كبيرة زيت زيتون، وكمون، وفلفل أسود\n- خيار ونعناع وليمون للسلطة\n\nطريقة تحضير مجدرة مع سلطة الخيار:\n1. اسلق العدس حتى يقارب النضج.\n2. حمّر البصل ببطء في زيت الزيتون حتى يصبح ذهبيًا غامقًا.\n3. أضف الأرز والعدس والبهارات والماء، ثم غطِّ القدر واتركه على نار هادئة حتى ينضج الأرز.\n4. زيّنه بالبصل، وقدّمه مع سلطة الخيار بالنعناع.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Date and tahini overnight oats | شوفان منقوع بالتمر والطحينة",
"text": "Yara vegan recipe: Date and tahini overnight oats (Arabic name: شوفان منقوع بالتمر والطحينة). Meal: Breakfast. Time: 5 minutes + overnight soak. Serves 1.\nProtein: about 10.6 g per serving (estimated from the ingredients).\nAbout: A no-cook breakfast with dates, oats, tahini, and plant milk.\n\nIngredients for date and tahini overnight oats:\n- ½ cup rolled oats\n- 1 cup unsweetened plant milk\n- 2 dates, chopped\n- 1 tbsp tahini\n- Cardamom and sesame seeds\n\nMethod for date and tahini overnight oats:\n1. Mix everything in a jar.\n2. Refrigerate for at least 4 hours, or overnight.\n3. Loosen with a splash of milk before serving if needed.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: شوفان منقوع بالتمر والطحينة | Recipe in Arabic: Date and tahini overnight oats",
"text": "وصفة نباتية من يارا: شوفان منقوع بالتمر والطحينة (Date and tahini overnight oats). الوجبة: فطور. مدة التحضير: 5 دقائق + نقع ليلة كاملة. عدد الحصص: 1.\nالبروتين: نحو 10.6 جم للحصة (تقدير من المكونات).\nنبذة: فطور بلا طبخ من الشوفان والتمر والطحينة والحليب النباتي.\n\nمكونات شوفان منقوع بالتمر والطحينة:\n- نصف كوب شوفان\n- كوب حليب نباتي غير محلّى\n- حبتا تمر مقطعتان\n- ملعقة كبيرة طحينة\n- هيل وسمسم\n\nطريقة تحضير شوفان منقوع بالتمر والطحينة:\n1. اخلط جميع المكونات في برطمان.\n2. ضعه في الثلاجة 4 ساعات على الأقل، أو طوال الليل.\n3. أضف قليلًا من الحليب قبل التقديم إذا احتاج.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Roasted vegetable tahini wrap | لفائف الخضار المشوية بالطحينة",
"text": "Yara vegan recipe: Roasted vegetable tahini wrap (Arabic name: لفائف الخضار المشوية بالطحينة). Meal: Lunch. Time: 30 minutes. Serves 2.\nProtein: about 15.3 g per serving (estimated from the ingredients).\nAbout: Roasted vegetables, chickpeas, and tahini in warm flatbread.\n\nIngredients for roasted vegetable tahini wrap:\n- 2 whole-wheat flatbreads or tortillas\n- 1½ cups chickpeas (most of a can)\n- 1 bell pepper and 1 zucchini\n- 1 tbsp olive oil, cumin, and black pepper\n- Tahini, lemon, and garlic\n- Parsley and pickles\n\nMethod for roasted vegetable tahini wrap:\n1. Roast the vegetables with the oil, cumin, and black pepper.\n2. Whisk the tahini with lemon, garlic, and a little water into a sauce.\n3. Fill the bread with the vegetables, chickpeas, sauce, and herbs.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: لفائف الخضار المشوية بالطحينة | Recipe in Arabic: Roasted vegetable tahini wrap",
"text": "وصفة نباتية من يارا: لفائف الخضار المشوية بالطحينة (Roasted vegetable tahini wrap). الوجبة: غداء. مدة التحضير: 30 دقيقة. عدد الحصص: 2.\nالبروتين: نحو 15.3 جم للحصة (تقدير من المكونات).\nنبذة: خضار مشوية وحمص وطحينة في خبز دافئ.\n\nمكونات لفائف الخضار المشوية بالطحينة:\n- رغيفا خبز قمح كامل أو تورتيلا\n- كوب ونصف من الحمص (معظم العلبة)\n- حبة فلفل رومي وحبة كوسة\n- ملعقة كبيرة زيت زيتون، وكمون، وفلفل أسود\n- طحينة وليمون وثوم\n- بقدونس ومخلل\n\nطريقة تحضير لفائف الخضار المشوية بالطحينة:\n1. اشوِ الخضار مع الزيت والكمون والفلفل الأسود.\n2. اخفق الطحينة مع الليمون والثوم وقليل من الماء حتى تصبح صلصة.\n3. احشُ الخبز بالخضار والحمص والصلصة والأعشاب.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Peanut butter and date toast | خبز محمص بزبدة الفول السوداني والتمر",
"text": "Yara vegan recipe: Peanut butter and date toast (Arabic name: خبز محمص بزبدة الفول السوداني والتمر). Meal: Breakfast or Snack. Time: 5 minutes. Serves 1.\nProtein: about 15.7 g per serving (estimated from the ingredients).\nAbout: Five minutes, three ingredients, and about 15 grams of protein.\n\nIngredients for peanut butter and date toast:\n- 1 Arabic bread or 2 slices of bread\n- 2 tbsp peanut butter\n- 2 dates, chopped\n- A pinch of cinnamon\n\nMethod for peanut butter and date toast:\n1. Toast the bread.\n2. Spread with peanut butter.\n3. Top with the dates and a pinch of cinnamon.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: خبز محمص بزبدة الفول السوداني والتمر | Recipe in Arabic: Peanut butter and date toast",
"text": "وصفة نباتية من يارا: خبز محمص بزبدة الفول السوداني والتمر (Peanut butter and date toast). الوجبة: فطور أو وجبة خفيفة. مدة التحضير: 5 دقائق. عدد الحصص: 1.\nالبروتين: نحو 15.7 جم للحصة (تقدير من المكونات).\nنبذة: خمس دقائق، وثلاثة مكونات، ونحو 15 جرامًا من البروتين.\n\nمكونات خبز محمص بزبدة الفول السوداني والتمر:\n- رغيف خبز عربي أو شريحتا خبز\n- ملعقتان كبيرتان زبدة فول سوداني\n- حبتا تمر مقطعتان\n- رشة قرفة\n\nطريقة تحضير خبز محمص بزبدة الفول السوداني والتمر:\n1. حمّص الخبز.\n2. ادهنه بزبدة الفول السوداني.\n3. وزّع التمر فوقه مع رشة قرفة.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Freekeh with chickpeas and parsley | فريكة بالحمص والبقدونس",
"text": "Yara vegan recipe: Freekeh with chickpeas and parsley (Arabic name: فريكة بالحمص والبقدونس). Meal: Lunch or Dinner. Time: 40 minutes. Serves 4.\nProtein: about 11.8 g per serving (estimated from the ingredients).\nAbout: Smoky green wheat with chickpeas, warm spices, lemon, and toasted almonds.\n\nIngredients for freekeh with chickpeas and parsley:\n- 1 cup cracked freekeh (about 170 g), rinsed\n- 1 can chickpeas (about 380 g), rinsed\n- 1 onion, chopped\n- 2 tbsp vegetable oil\n- 1 tsp cumin, ½ tsp black pepper, a pinch of cardamom\n- 2½ cups water and salt\n- Parsley, lemon, and a handful of toasted almonds\n\nMethod for freekeh with chickpeas and parsley:\n1. Soften the onion in the oil until golden.\n2. Stir in the spices and freekeh and toast for a minute.\n3. Add the water and salt, bring to a boil, then cover and simmer for 20 to 25 minutes until tender.\n4. Fold in the chickpeas and warm through for 5 minutes, then rest off the heat.\n5. Finish with parsley, lemon, and almonds.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: فريكة بالحمص والبقدونس | Recipe in Arabic: Freekeh with chickpeas and parsley",
"text": "وصفة نباتية من يارا: فريكة بالحمص والبقدونس (Freekeh with chickpeas and parsley). الوجبة: غداء أو عشاء. مدة التحضير: 40 دقيقة. عدد الحصص: 4.\nالبروتين: نحو 11.8 جم للحصة (تقدير من المكونات).\nنبذة: قمح أخضر مدخّن مع الحمص والبهارات الدافئة والليمون واللوز المحمص.\n\nمكونات فريكة بالحمص والبقدونس:\n- كوب فريكة مجروشة (نحو 170 جم) مغسولة\n- علبة حمص (نحو 380 جم) مصفّاة ومغسولة\n- بصلة مفرومة\n- ملعقتان كبيرتان زيت نباتي\n- ملعقة صغيرة كمون، ونصف ملعقة صغيرة فلفل أسود، ورشة هيل\n- كوبان ونصف من الماء وملح\n- بقدونس وليمون وحفنة لوز محمص\n\nطريقة تحضير فريكة بالحمص والبقدونس:\n1. قلّب البصل في الزيت حتى يذبل ويصفرّ.\n2. أضف البهارات والفريكة وقلّبها دقيقة.\n3. أضف الماء والملح، واتركه حتى يغلي، ثم غطِّه واتركه على نار هادئة 20 إلى 25 دقيقة حتى تنضج الفريكة.\n4. أضف الحمص وقلّبه 5 دقائق حتى يسخن، ثم ارفعه عن النار واتركه يرتاح.\n5. زيّنه بالبقدونس والليمون واللوز.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Smooth hummus | حمص بالطحينة",
"text": "Yara vegan recipe: Smooth hummus (Arabic name: حمص بالطحينة). Meal: Snack. Time: 10 minutes. Serves 6.\nProtein: about 4.7 g per serving (estimated from the ingredients).\nAbout: The everyday dip, made silky by blending the tahini and lemon first.\n\nIngredients for smooth hummus:\n- 1 can chickpeas (about 380 g), drained, liquid kept\n- 3 tbsp tahini\n- Juice of 1 lemon\n- 1 garlic clove\n- ½ tsp cumin and salt\n- Ice water or the can's liquid\n- Olive oil to finish\n\nMethod for smooth hummus:\n1. Blend the tahini, lemon, garlic, and salt until pale and thick.\n2. Add the chickpeas and cumin and blend.\n3. Loosen with ice water or the can's liquid, a spoonful at a time, until smooth.\n4. Serve topped with olive oil and cumin.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: حمص بالطحينة | Recipe in Arabic: Smooth hummus",
"text": "وصفة نباتية من يارا: حمص بالطحينة (Smooth hummus). الوجبة: وجبة خفيفة. مدة التحضير: 10 دقائق. عدد الحصص: 6.\nالبروتين: نحو 4.7 جم للحصة (تقدير من المكونات).\nنبذة: الغموس اليومي، ناعم كالحرير لأننا نخفق الطحينة والليمون أولًا.\n\nمكونات حمص بالطحينة:\n- علبة حمص (نحو 380 جم) مصفّاة مع الاحتفاظ بمائها\n- 3 ملاعق كبيرة طحينة\n- عصير ليمونة\n- فص ثوم\n- نصف ملعقة صغيرة كمون وملح\n- ماء مثلّج أو ماء العلبة\n- زيت زيتون للتقديم\n\nطريقة تحضير حمص بالطحينة:\n1. اخلط الطحينة والليمون والثوم والملح حتى يفتح لونها وتتماسك.\n2. أضف الحمص والكمون واخلط.\n3. أضف الماء المثلج أو ماء العلبة ملعقةً ملعقة حتى يصبح ناعمًا.\n4. قدّمه مع زيت الزيتون والكمون.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Crunchy roasted chickpeas | حمص محمص مقرمش",
"text": "Yara vegan recipe: Crunchy roasted chickpeas (Arabic name: حمص محمص مقرمش). Meal: Snack. Time: 40 minutes. Serves 4.\nProtein: about 4.8 g per serving (estimated from the ingredients).\nAbout: An oven snack that keeps for two days in an open jar.\n\nIngredients for crunchy roasted chickpeas:\n- 1 can chickpeas (about 380 g), drained and rinsed\n- 1 tbsp olive oil\n- ½ tsp cumin, ½ tsp chili powder, and salt\n\nMethod for crunchy roasted chickpeas:\n1. Heat the oven to 200°C.\n2. Pat the chickpeas very dry with a towel.\n3. Toss with the oil and spices.\n4. Roast for 30 to 35 minutes, shaking the tray halfway, until crisp. They crisp more as they cool.\n\nSource: a Yara original recipe."
},
{
"file": "yara-recipes.md",
"title": "وصفة: حمص محمص مقرمش | Recipe in Arabic: Crunchy roasted chickpeas",
"text": "وصفة نباتية من يارا: حمص محمص مقرمش (Crunchy roasted chickpeas). الوجبة: وجبة خفيفة. مدة التحضير: 40 دقيقة. عدد الحصص: 4.\nالبروتين: نحو 4.8 جم للحصة (تقدير من المكونات).\nنبذة: وجبة خفيفة من الفرن تبقى مقرمشة يومين في برطمان مفتوح.\n\nمكونات حمص محمص مقرمش:\n- علبة حمص (نحو 380 جم) مصفّاة ومغسولة\n- ملعقة كبيرة زيت زيتون\n- نصف ملعقة صغيرة كمون، ونصف ملعقة صغيرة شطة، وملح\n\nطريقة تحضير حمص محمص مقرمش:\n1. سخّن الفرن على 200 درجة مئوية.\n2. جفّف الحمص جيدًا بمنشفة.\n3. قلّبه مع الزيت والبهارات.\n4. حمّصه 30 إلى 35 دقيقة مع هزّ الصينية في المنتصف حتى يقرمش. يزداد قرمشة عندما يبرد.\n\nالمصدر: وصفة أصلية من يارا."
},
{
"file": "yara-recipes.md",
"title": "Recipe: Lentil vegetable soup | شوربة العدس بالخضار",
"text": "Yara vegan recipe: Lentil vegetable soup (Arabic name: شوربة العدس بالخضار). Meal: Lunch or Dinner. Time: 60 minutes. Serves 6.\nProtein: 9 g per serving (from the original recipe's USDA nutrition panel), 163 kcal.\nAbout: A slow, hearty lentil soup that suits a cold evening or the iftar table.\n\nIngredients for lentil vegetable soup:\n- 1 cup dry red or brown lentils (about 190 g), rinsed\n- 5 cups water\n- 2 tbsp vegetable oil\n- Half an onion, finely chopped\n- 1 cup canned chopped tomatoes, blended\n- 1 garlic clove\n- 1 tsp salt, ¼ tsp black pepper, 1 bay leaf\n- 1 celery stalk, chopped\n- 2 tbsp vinegar, or the juice of half a lemon\n\nMethod for lentil vegetable soup:\n1. Put the lentils and water in a deep pot and bring to a boil.\n2. Add everything except the vinegar or lemon, lower the heat, and cover.\n3. Simmer gently, adding water if needed: about 30 minutes for red lentils, up to an hour for brown.\n4. Stir in the vinegar or lemon and remove the bay leaf. Serve with extra lemon and cumin.\n\nWhat Yara changed: We use canned chopped tomatoes because tomato sauce is less common here, and lemon works instead of vinegar.\n\nSource: Adapted for Saudi kitchens by Yara. Original recipe by University of Nebraska–Lincoln, Nebraska Nutrition Education Program, published by the U.S. Department of Agriculture on MyPlate Kitchen (public domain), from the edition preserved by MyPlate.food. Original recipe: \"Lentil Vegetable Soup\", https://myplate.food/recipes/lentil-vegetable-soup"
},
{
"file": "yara-recipes.md",
"title": "وصفة: شوربة العدس بالخضار | Recipe in Arabic: Lentil vegetable soup",
"text": "وصفة نباتية من يارا: شوربة العدس بالخضار (Lentil vegetable soup). الوجبة: غداء أو عشاء. مدة التحضير: 60 دقيقة. عدد الحصص: 6.\nالبروتين: 9 جم للحصة (من لوحة التغذية الأصلية للوصفة لدى وزارة الزراعة الأمريكية).\nنبذة: شوربة عدس دافئة على نار هادئة، تناسب المساء البارد ومائدة الإفطار.\n\nمكونات شوربة العدس بالخضار:\n- كوب عدس أحمر أو بني (نحو 190 جم) مغسول\n- 5 أكواب ماء\n- ملعقتان كبيرتان زيت نباتي\n- نصف بصلة مفرومة ناعمًا\n- كوب طماطم معلبة مقطعة ومهروسة\n- فص ثوم\n- ملعقة صغيرة ملح، وربع ملعقة صغيرة فلفل أسود، وورقة غار\n- عود كرفس مقطع\n- ملعقتان كبيرتان خل، أو عصير نصف ليمونة\n\nطريقة تحضير شوربة العدس بالخضار:\n1. ضع العدس والماء في قدر عميق واتركه حتى يغلي.\n2. أضف كل المكونات عدا الخل أو الليمون، وخفّف النار وغطِّ القدر.\n3. اتركه على نار هادئة مع إضافة الماء عند الحاجة: نحو 30 دقيقة للعدس الأحمر، وحتى ساعة للبني.\n4. أضف الخل أو الليمون وأخرج ورقة الغار. قدّمها مع ليمون وكمون إضافيين.\n\nما الذي غيّرته يارا: استخدمنا الطماطم المعلبة لأن صلصة الطماطم أقل شيوعًا هنا، ويصلح الليمون بدل الخل.\n\nالمصدر: كيّفتها يارا للمطبخ السعودي. الوصفة الأصلية من University of Nebraska–Lincoln, Nebraska Nutrition Education Program، ونشرتها وزارة الزراعة الأمريكية على MyPlate Kitchen (ملكية عامة)، عن النسخة المحفوظة في MyPlate.food. الوصفة الأصلية: \"Lentil Vegetable Soup\"، https://myplate.food/recipes/lentil-vegetable-soup"
},
{
"file": "yara-recipes.md",
"title": "Recipe: Spiced lentil wraps | لفائف العدس المتبّل",
"text": "Yara vegan recipe: Spiced lentil wraps (Arabic name: لفائف العدس المتبّل). Meal: Lunch or Dinner. Time: 45 minutes. Serves 6.\nProtein: 14.2 g per serving (from the original recipe's USDA nutrition panel), 193 kcal; figures are for the filling, without the bread.\nAbout: Lentils simmered with pepper, garlic, cumin, and tomato, rolled in warm bread.\n\nIngredients for spiced lentil wraps:\n- 1½ cups dry brown lentils (about 285 g), rinsed\n- 4 cups water\n- Half a green bell pepper, chopped\n- 4 garlic cloves, minced\n- 1 tsp chili powder, 1 tsp cumin, ½ tsp dried basil, chili flakes to taste\n- ⅔ cup tomato paste\n- ¼ cup raisins (optional)\n- 6 tortillas or Arabic breads to serve\n\nMethod for spiced lentil wraps:\n1. Cook the lentils in 3 cups of the water for 10 minutes.\n2. Add everything else and simmer for 30 minutes, adding water if it gets dry.\n3. Spoon into warm tortillas or Arabic bread, or serve over rice.\n\nWhat Yara changed: The original serves this in corn tortillas; Arabic bread or brown tortillas from Saudi shops work just as well.\n\nSource: Adapted for Saudi kitchens by Yara. Original recipe by Washington State WIC Program, published by the U.S. Department of Agriculture on MyPlate Kitchen (public domain), from the edition preserved by MyPlate.food. Original recipe: \"Lentil Tacos\", https://myplate.food/recipes/lentil-tacos"
},
{
"file": "yara-recipes.md",
"title": "وصفة: لفائف العدس المتبّل | Recipe in Arabic: Spiced lentil wraps",
"text": "وصفة نباتية من يارا: لفائف العدس المتبّل (Spiced lentil wraps). الوجبة: غداء أو عشاء. مدة التحضير: 45 دقيقة. عدد الحصص: 6.\nالبروتين: 14.2 جم للحصة (من لوحة التغذية الأصلية للوصفة لدى وزارة الزراعة الأمريكية).\nنبذة: عدس مطبوخ مع الفلفل والثوم والكمون والطماطم، ملفوف في خبز دافئ.\n\nمكونات لفائف العدس المتبّل:\n- كوب ونصف عدس بني (نحو 285 جم) مغسول\n- 4 أكواب ماء\n- نصف حبة فلفل رومي أخضر مقطعة\n- 4 فصوص ثوم مفرومة\n- ملعقة صغيرة شطة، وملعقة صغيرة كمون، ونصف ملعقة صغيرة ريحان مجفف، وشطة مجروشة حسب الرغبة\n- ثلثا كوب معجون طماطم\n- ربع كوب زبيب (اختياري)\n- 6 أرغفة تورتيلا أو خبز عربي للتقديم\n\nطريقة تحضير لفائف العدس المتبّل:\n1. اطبخ العدس في 3 أكواب من الماء 10 دقائق.\n2. أضف باقي المكونات واتركه على نار هادئة 30 دقيقة، مع إضافة الماء إذا جفّ.\n3. ضعه في خبز تورتيلا أو خبز عربي دافئ، أو قدّمه فوق الأرز.\n\nما الذي غيّرته يارا: تُقدَّم الوصفة الأصلية في تورتيلا الذرة، ويصلح الخبز العربي أو التورتيلا السمراء المتوفرة هنا بالقدر نفسه.\n\nالمصدر: كيّفتها يارا للمطبخ السعودي. الوصفة الأصلية من Washington State WIC Program، ونشرتها وزارة الزراعة الأمريكية على MyPlate Kitchen (ملكية عامة)، عن النسخة المحفوظة في MyPlate.food. الوصفة الأصلية: \"Lentil Tacos\"، https://myplate.food/recipes/lentil-tacos"
},
{
"file": "yara-recipes.md",
"title": "Recipe: Garden white bean salad | سلطة الفاصوليا البيضاء بالخضار",
"text": "Yara vegan recipe: Garden white bean salad (Arabic name: سلطة الفاصوليا البيضاء بالخضار). Meal: Lunch. Time: 20 minutes. Serves 4.\nProtein: 20.2 g per serving (from the original recipe's USDA nutrition panel), 409 kcal.\nAbout: White beans, crunchy vegetables, and toasted almonds with a lemon and date-syrup dressing.\n\nIngredients for garden white bean salad:\n- Dressing: 1 tbsp olive oil, 2 tsp vinegar, juice of half a lemon, 1 tbsp date syrup, dried basil and garlic powder\n- ½ cup slivered almonds\n- 2 tomatoes, chopped\n- Half a bell pepper, chopped\n- Half a cucumber, chopped\n- 3 green onions, sliced\n- 2 cans white beans (about 380 g each), drained and rinsed\n- Lettuce leaves to serve\n\nMethod for garden white bean salad:\n1. Whisk the dressing in a small bowl.\n2. Toast the almonds in a dry pan until golden, then let them cool.\n3. Toss everything except the lettuce with the dressing and chill until serving.\n4. Spoon onto lettuce leaves.\n\nWhat Yara changed: The original dressing uses apple juice; we sweeten it with a spoon of date syrup instead.\n\nSource: Adapted for Saudi kitchens by Yara. Original recipe by Produce for Better Health Foundation, published by the U.S. Department of Agriculture on MyPlate Kitchen (public domain), from the edition preserved by MyPlate.food. Original recipe: \"Garden Cannellini Bean Salad\", https://myplate.food/recipes/garden-cannellini-bean-salad"
},
{
"file": "yara-recipes.md",
"title": "وصفة: سلطة الفاصوليا البيضاء بالخضار | Recipe in Arabic: Garden white bean salad",
"text": "وصفة نباتية من يارا: سلطة الفاصوليا البيضاء بالخضار (Garden white bean salad). الوجبة: غداء. مدة التحضير: 20 دقيقة. عدد الحصص: 4.\nالبروتين: 20.2 جم للحصة (من لوحة التغذية الأصلية للوصفة لدى وزارة الزراعة الأمريكية).\nنبذة: فاصوليا بيضاء وخضار مقرمشة ولوز محمص مع صلصة الليمون ودبس التمر.\n\nمكونات سلطة الفاصوليا البيضاء بالخضار:\n- الصلصة: ملعقة كبيرة زيت زيتون، وملعقتان صغيرتان خل، وعصير نصف ليمونة، وملعقة كبيرة دبس تمر، وريحان مجفف وثوم بودرة\n- نصف كوب لوز مقطع أصابع\n- حبتا طماطم مقطعتان\n- نصف حبة فلفل رومي مقطعة\n- نصف حبة خيار مقطعة\n- 3 أعواد بصل أخضر مقطعة\n- علبتا فاصوليا بيضاء (نحو 380 جم لكل علبة) مصفّاة ومغسولة\n- أوراق خس للتقديم\n\nطريقة تحضير سلطة الفاصوليا البيضاء بالخضار:\n1. اخفق مكونات الصلصة في وعاء صغير.\n2. حمّص اللوز في مقلاة جافة حتى يصفرّ، ثم اتركه يبرد.\n3. اخلط كل المكونات عدا الخس مع الصلصة، وضعها في الثلاجة حتى التقديم.\n4. قدّمها فوق أوراق الخس.\n\nما الذي غيّرته يارا: تستخدم الصلصة الأصلية عصير التفاح، وحلّيناها نحن بملعقة من دبس التمر.\n\nالمصدر: كيّفتها يارا للمطبخ السعودي. الوصفة الأصلية من Produce for Better Health Foundation، ونشرتها وزارة الزراعة الأمريكية على MyPlate Kitchen (ملكية عامة)، عن النسخة المحفوظة في MyPlate.food. الوصفة الأصلية: \"Garden Cannellini Bean Salad\"، https://myplate.food/recipes/garden-cannellini-bean-salad"
},
{
"file": "yara-recipes.md",
"title": "Recipe: Chickpeas and spinach sauté | حمص مع السبانخ",
"text": "Yara vegan recipe: Chickpeas and spinach sauté (Arabic name: حمص مع السبانخ). Meal: Dinner. Time: 35 minutes. Serves 4.\nProtein: 9.7 g per serving (from the original recipe's USDA nutrition panel), 193 kcal.\nAbout: Soft vegetables, tomatoes, chickpeas, and wilted spinach in one pan. Any beans and greens work.\n\nIngredients for chickpeas and spinach sauté:\n- 1 tbsp vegetable oil\n- 1 onion, chopped\n- 1 garlic clove, minced\n- 1 celery stalk, chopped\n- 1 carrot, chopped\n- 1 can chopped tomatoes (about 400 g)\n- 1 can chickpeas (about 380 g), drained and rinsed\n- ¼ cup water\n- About 300 g spinach (frozen, or 2 fresh bunches)\n- 1 tsp lemon juice and a pinch of chili flakes\n\nMethod for chickpeas and spinach sauté:\n1. Heat the oil and cook the onion, garlic, celery, and carrot for about 15 minutes until soft and lightly browned.\n2. Turn up the heat, add the tomatoes, chickpeas, and water, and cook for 5 minutes.\n3. Lower the heat, pile the spinach on top, cover, and cook for about 10 minutes.\n4. Stir in the lemon and chili. Serve with rice or quinoa.\n\nSource: Adapted for Saudi kitchens by Yara. Original recipe by USDA Center for Nutrition Policy and Promotion, published by the U.S. Department of Agriculture on MyPlate Kitchen (public domain), from the edition preserved by MyPlate.food. Original recipe: \"Chickpeas and Spinach Sauté\", https://myplate.food/recipes/chickpeas-and-spinach-saute"
},
{
"file": "yara-recipes.md",
"title": "وصفة: حمص مع السبانخ | Recipe in Arabic: Chickpeas and spinach sauté",
"text": "وصفة نباتية من يارا: حمص مع السبانخ (Chickpeas and spinach sauté). الوجبة: عشاء. مدة التحضير: 35 دقيقة. عدد الحصص: 4.\nالبروتين: 9.7 جم للحصة (من لوحة التغذية الأصلية للوصفة لدى وزارة الزراعة الأمريكية).\nنبذة: خضار طرية وطماطم وحمص وسبانخ ذابلة في مقلاة واحدة. تصلح أي بقوليات مع أي خضار ورقية.\n\nمكونات حمص مع السبانخ:\n- ملعقة كبيرة زيت نباتي\n- بصلة مفرومة\n- فص ثوم مفروم\n- عود كرفس مقطع\n- حبة جزر مقطعة\n- علبة طماطم مقطعة (نحو 400 جم)\n- علبة حمص (نحو 380 جم) مصفّاة ومغسولة\n- ربع كوب ماء\n- نحو 300 جم سبانخ (مجمدة، أو ربطتان طازجتان)\n- ملعقة صغيرة عصير ليمون ورشة شطة مجروشة\n\nطريقة تحضير حمص مع السبانخ:\n1. سخّن الزيت واطبخ البصل والثوم والكرفس والجزر نحو 15 دقيقة حتى تطرى وتتحمّر قليلًا.\n2. ارفع النار وأضف الطماطم والحمص والماء، واطبخها 5 دقائق.\n3. خفّف النار وضع السبانخ فوقها، ثم غطِّها واطبخها نحو 10 دقائق.\n4. أضف الليمون والشطة وقلّب. قدّمه مع الأرز أو الكينوا.\n\nالمصدر: كيّفتها يارا للمطبخ السعودي. الوصفة الأصلية من USDA Center for Nutrition Policy and Promotion، ونشرتها وزارة الزراعة الأمريكية على MyPlate Kitchen (ملكية عامة)، عن النسخة المحفوظة في MyPlate.food. الوصفة الأصلية: \"Chickpeas and Spinach Sauté\"، https://myplate.food/recipes/chickpeas-and-spinach-saute"
},
{
"file": "yara-recipes.md",
"title": "Recipe: Red beans and rice | فاصوليا حمراء مع الأرز",
"text": "Yara vegan recipe: Red beans and rice (Arabic name: فاصوليا حمراء مع الأرز). Meal: Lunch or Dinner. Time: 45 minutes. Serves 4.\nProtein: 17.5 g per serving (from the original recipe's USDA nutrition panel), 479 kcal.\nAbout: Kidney beans simmered with pepper, onion, tomato, and cumin over rice, topped with avocado and coriander.\n\nIngredients for red beans and rice:\n- 1 cup rice (brown, or basmati for a faster cook)\n- 2 tsp vegetable oil\n- 2 garlic cloves, minced\n- 1 small onion, chopped\n- 1 bell pepper, chopped\n- 1 tomato, chopped\n- ¼ tsp salt and a pinch of cumin\n- 2 cans red kidney beans (about 400 g each), drained and rinsed\n- 1½ cups water\n- 1 avocado and 2 tbsp chopped coriander\n\nMethod for red beans and rice:\n1. Cook the rice: about 20 minutes for basmati, 45 for brown.\n2. Meanwhile, heat the oil and cook the garlic, onion, and pepper with 2 tbsp water until golden, about 10 minutes.\n3. Add the tomato, salt, cumin, beans, and water and simmer until the beans are very soft, 20 to 30 minutes.\n4. Serve the beans over the rice, topped with avocado and coriander. Keeps 3 days in the fridge.\n\nWhat Yara changed: Brown rice is the original; basmati is what most Saudi kitchens have, and it cooks in half the time.\n\nSource: Adapted for Saudi kitchens by Yara. Original recipe by USDA Center for Nutrition Policy and Promotion, published by the U.S. Department of Agriculture on MyPlate Kitchen (public domain), from the edition preserved by MyPlate.food. Original recipe: \"Red Beans and Rice\", https://myplate.food/recipes/red-beans-and-rice-0"
},
{
"file": "yara-recipes.md",
"title": "وصفة: فاصوليا حمراء مع الأرز | Recipe in Arabic: Red beans and rice",
"text": "وصفة نباتية من يارا: فاصوليا حمراء مع الأرز (Red beans and rice). الوجبة: غداء أو عشاء. مدة التحضير: 45 دقيقة. عدد الحصص: 4.\nالبروتين: 17.5 جم للحصة (من لوحة التغذية الأصلية للوصفة لدى وزارة الزراعة الأمريكية).\nنبذة: فاصوليا حمراء مطبوخة مع الفلفل والبصل والطماطم والكمون فوق الأرز، مع الأفوكادو والكزبرة.\n\nمكونات فاصوليا حمراء مع الأرز:\n- كوب أرز (بني، أو بسمتي لطبخ أسرع)\n- ملعقتان صغيرتان زيت نباتي\n- فصا ثوم مفرومان\n- بصلة صغيرة مفرومة\n- حبة فلفل رومي مقطعة\n- حبة طماطم مقطعة\n- ربع ملعقة صغيرة ملح ورشة كمون\n- علبتا فاصوليا حمراء (نحو 400 جم لكل علبة) مصفّاة ومغسولة\n- كوب ونصف ماء\n- حبة أفوكادو وملعقتان كبيرتان كزبرة مفرومة\n\nطريقة تحضير فاصوليا حمراء مع الأرز:\n1. اطبخ الأرز: نحو 20 دقيقة للبسمتي، و45 للبني.\n2. في الأثناء، سخّن الزيت واطبخ الثوم والبصل والفلفل مع ملعقتين كبيرتين من الماء حتى تصفرّ، نحو 10 دقائق.\n3. أضف الطماطم والملح والكمون والفاصوليا والماء، واتركها على نار هادئة حتى تطرى الفاصوليا جيدًا، 20 إلى 30 دقيقة.\n4. قدّم الفاصوليا فوق الأرز مع الأفوكادو والكزبرة. تبقى 3 أيام في الثلاجة.\n\nما الذي غيّرته يارا: الأرز البني هو الأصل، والبسمتي هو الموجود في أغلب المطابخ السعودية ويُطبخ في نصف الوقت.\n\nالمصدر: كيّفتها يارا للمطبخ السعودي. الوصفة الأصلية من USDA Center for Nutrition Policy and Promotion، ونشرتها وزارة الزراعة الأمريكية على MyPlate Kitchen (ملكية عامة)، عن النسخة المحفوظة في MyPlate.food. الوصفة الأصلية: \"Red Beans and Rice\"، https://myplate.food/recipes/red-beans-and-rice-0"
},
{
"file": "yara-ingredients.md",
"title": "About Yara's ingredients guide | عن دليل مكونات يارا",
"text": "This guide describes the plant-based ingredients Yara tracks in Saudi supermarkets: Arabic and English names, protein, how to cook them, what to check on the label, which stores sell them, and which Yara recipes use them.\nThis guide has no prices. Prices come only from Yara's live price list. If the live list has no price for something, say so.\nProtein values are typical values in grams per 100 g as sold (per 100 ml for milks); labels vary a little by brand."
},
{
"file": "yara-ingredients.md",
"title": "Plant foods with the most protein per 100 g | أغنى الأطعمة النباتية بالبروتين",
"text": "Typical grams of protein per 100 g as sold (dry weight for beans, lentils and grains):\n- Pumpkin seeds (shelled) (بذور اليقطين المقشرة): 30 g\n- Red lentils (عدس أحمر): 24 g\n- Brown lentils (whole) (عدس بني (حب)): 24 g\n- Dried green peas (بازلاء خضراء مجففة): 24 g\n- Mung beans (whole) (ماش (حب)): 24 g\n- Peanuts (roasted) (فول سوداني محمص): 24 g\n- Peanut butter (زبدة الفول السوداني): 24 g\n- Black-eyed beans (لوبيا): 23 g\n- Red kidney beans (dry) (فاصوليا حمراء): 23 g\n- White beans (dry) (فاصوليا بيضاء): 22 g\n- Almonds (لوز): 21 g\n- Chickpeas (dry) (حمص حب): 20 g\n- Split chickpeas (chana dal) (حمص مجروش (تشانا دال)): 20 g\n- Sesame seeds (سمسم): 18 g\n- Tahini (طحينة): 17 g\n- Chia seeds (بذور الشيا): 17 g\n- Quinoa (كينوا): 14 g\n- Rolled oats (شوفان): 13 g\n- Freekeh (فريكة): 12 g\n- Bulgur (برغل): 12 g"
},
{
"file": "yara-ingredients.md",
"title": "Black-eyed beans | لوبيا",
"text": "Ingredient: Black-eyed beans (لوبيا). Category: Beans and lentils | البقوليات.\nAlso called: لوبيا ناشفة.\nProtein: 23 g per 100 g (typical value).\nHow to use black-eyed beans: Cook without soaking in 40 to 50 minutes, or about 30 minutes after a few hours of soaking.\nWhere Yara has found black-eyed beans: LuLu."
},
{
"file": "yara-ingredients.md",
"title": "Brown lentils (whole) | عدس بني (حب)",
"text": "Ingredient: Brown lentils (whole) (عدس بني (حب)). Category: Beans and lentils | البقوليات.\nAlso called: عدس حب، عدس أخضر.\nProtein: 24 g per 100 g (typical value).\nHow to use brown lentils (whole): Whole lentils that hold their shape, for kabsa, mujaddara and salads. No soaking. Simmer 25 to 30 minutes.\nWhere Yara has found brown lentils (whole): Carrefour, LuLu.\nYara recipes that use brown lentils (whole): Lentil kabsa (كبسة العدس), Mujaddara with cucumber salad (مجدرة مع سلطة الخيار), Spiced lentil wraps (لفائف العدس المتبّل)."
},
{
"file": "yara-ingredients.md",
"title": "Chickpeas (canned) | حمص معلب",
"text": "Ingredient: Chickpeas (canned) (حمص معلب). Category: Beans and lentils | البقوليات.\nAlso called: حمص معلب.\nProtein: 5 g per 100 g (typical value).\nHow to use chickpeas (canned): Ready to use. Drain and rinse to cut the salt. A 380 to 400 g can gives roughly 240 g of chickpeas.\nWhere Yara has found chickpeas (canned): LuLu.\nYara recipes that use chickpeas (canned): Chickpea kabsa bowl (طبق الحمص بنكهة الكبسة), Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة), Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس), Smooth hummus (حمص بالطحينة), Crunchy roasted chickpeas (حمص محمص مقرمش), Chickpeas and spinach sauté (حمص مع السبانخ)."
},
{
"file": "yara-ingredients.md",
"title": "Chickpeas (dry) | حمص حب",
"text": "Ingredient: Chickpeas (dry) (حمص حب). Category: Beans and lentils | البقوليات.\nAlso called: حمص ناشف.\nProtein: 20 g per 100 g (typical value).\nHow to use chickpeas (dry): Soak 8 to 12 hours (a pinch of baking soda helps), then simmer 60 to 90 minutes, or about 30 minutes in a pressure cooker. Much cheaper than canned; cook a big batch and freeze it.\nWhere Yara has found chickpeas (dry): Carrefour, LuLu."
},
{
"file": "yara-ingredients.md",
"title": "Dried green peas | بازلاء خضراء مجففة",
"text": "Ingredient: Dried green peas (بازلاء خضراء مجففة). Category: Beans and lentils | البقوليات.\nAlso called: بازلاء ناشفة.\nProtein: 24 g per 100 g (typical value).\nHow to use dried green peas: Whole dried peas: soak overnight, then simmer 45 to 60 minutes. Split peas need no soaking and take 30 to 40 minutes. Check which one the pack holds.\nWhere Yara has found dried green peas: LuLu."
},
{
"file": "yara-ingredients.md",
"title": "Foul medames (canned) | فول مدمس معلب",
"text": "Ingredient: Foul medames (canned) (فول مدمس معلب). Category: Beans and lentils | البقوليات.\nAlso called: فول معلب، فول مدمس.\nProtein: 5.5 g per 100 g (typical value).\nHow to use foul medames (canned): Cooked fava beans. Warm with garlic, lemon, cumin and tahini for breakfast. Rinse if you want less salt.\nWhere Yara has found foul medames (canned): LuLu, Panda.\nYara recipes that use foul medames (canned): Foul with tahini and herbs (فول بالطحينة والأعشاب)."
},
{
"file": "yara-ingredients.md",
"title": "Hummus with tahini (canned) | حمص بالطحينة معلب",
"text": "Ingredient: Hummus with tahini (canned) (حمص بالطحينة معلب). Category: Beans and lentils | البقوليات.\nProtein: 7 g per 100 g (typical value).\nHow to use hummus with tahini (canned): Ready-made hummus with tahini. Usually vegan; check the label for dairy.\nWhere Yara has found hummus with tahini (canned): LuLu."
},
{
"file": "yara-ingredients.md",
"title": "Mung beans (whole) | ماش (حب)",
"text": "Ingredient: Mung beans (whole) (ماش (حب)). Category: Beans and lentils | البقوليات.\nAlso called: ماش.\nProtein: 24 g per 100 g (typical value).\nHow to use mung beans (whole): No soaking needed, though 2 to 4 hours speeds them up. Simmer 30 to 40 minutes. Good in soups and with rice.\nWhere Yara has found mung beans (whole): LuLu."
},
{
"file": "yara-ingredients.md",
"title": "Red kidney beans (canned) | فاصوليا حمراء معلبة",
"text": "Ingredient: Red kidney beans (canned) (فاصوليا حمراء معلبة). Category: Beans and lentils | البقوليات.\nProtein: 5 g per 100 g (typical value).\nHow to use red kidney beans (canned): Already cooked and safe to use straight away. Drain and rinse.\nWhere Yara has found red kidney beans (canned): LuLu.\nYara recipes that use red kidney beans (canned): Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Red kidney beans (dry) | فاصوليا حمراء",
"text": "Ingredient: Red kidney beans (dry) (فاصوليا حمراء). Category: Beans and lentils | البقوليات.\nAlso called: فاصوليا حمراء ناشفة.\nProtein: 23 g per 100 g (typical value).\nHow to use red kidney beans (dry): Soak 8 to 12 hours, then boil hard for at least 10 minutes before simmering 60 to 90 minutes. Raw or undercooked kidney beans contain a natural toxin, so never slow-cook them from raw.\nWhere Yara has found red kidney beans (dry): LuLu."
},
{
"file": "yara-ingredients.md",
"title": "Red lentils | عدس أحمر",
"text": "Ingredient: Red lentils (عدس أحمر). Category: Beans and lentils | البقوليات.\nAlso called: عدس مجروش، عدس شوربة.\nProtein: 24 g per 100 g (typical value).\nHow to use red lentils: Split, skinless lentils that cook fast and melt into soup (shorbat adas). No soaking. Simmer 15 to 20 minutes in about three times their volume of water.\nWhere Yara has found red lentils: Carrefour, LuLu, Panda.\nYara recipes that use red lentils: Lentil vegetable soup (شوربة العدس بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "Split chickpeas (chana dal) | حمص مجروش (تشانا دال)",
"text": "Ingredient: Split chickpeas (chana dal) (حمص مجروش (تشانا دال)). Category: Beans and lentils | البقوليات.\nAlso called: تشانا دال.\nProtein: 20 g per 100 g (typical value).\nHow to use split chickpeas (chana dal): Split, skinned chickpeas. Soak 30 minutes to 2 hours, then simmer 30 to 45 minutes. Good in soups and dals.\nWhere Yara has found split chickpeas (chana dal): LuLu."
},
{
"file": "yara-ingredients.md",
"title": "White beans (canned) | فاصوليا بيضاء معلبة",
"text": "Ingredient: White beans (canned) (فاصوليا بيضاء معلبة). Category: Beans and lentils | البقوليات.\nProtein: 6 g per 100 g (typical value).\nHow to use white beans (canned): Drain and rinse. Good in salads and quick stews.\nWhere Yara has found white beans (canned): LuLu.\nYara recipes that use white beans (canned): Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "White beans (dry) | فاصوليا بيضاء",
"text": "Ingredient: White beans (dry) (فاصوليا بيضاء). Category: Beans and lentils | البقوليات.\nAlso called: فاصوليا بيضاء ناشفة.\nProtein: 22 g per 100 g (typical value).\nHow to use white beans (dry): Soak 8 to 12 hours and simmer 60 to 90 minutes until creamy. Classic in tomato stews.\nWhere Yara has found white beans (dry): Carrefour, Panda."
},
{
"file": "yara-ingredients.md",
"title": "Basmati rice | أرز بسمتي",
"text": "Ingredient: Basmati rice (أرز بسمتي). Category: Grains and pasta | الحبوب والمعكرونة.\nProtein: 7.5 g per 100 g (typical value).\nHow to use basmati rice: Rinse until the water runs clear. About 1 cup rice to 1½ cups water, 15 to 20 minutes, then rest 5 minutes.\nWhere Yara has found basmati rice: Panda.\nYara recipes that use basmati rice: Lentil kabsa (كبسة العدس), Chickpea kabsa bowl (طبق الحمص بنكهة الكبسة), Mujaddara with cucumber salad (مجدرة مع سلطة الخيار), Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Bulgur | برغل",
"text": "Ingredient: Bulgur (برغل). Category: Grains and pasta | الحبوب والمعكرونة.\nAlso called: برغل.\nProtein: 12 g per 100 g (typical value).\nHow to use bulgur: Fine bulgur: soak in boiling water for 10 to 15 minutes (for tabbouleh). Coarse bulgur: simmer in twice its volume of water for 12 to 15 minutes.\nWhere Yara has found bulgur: Carrefour."
},
{
"file": "yara-ingredients.md",
"title": "Freekeh | فريكة",
"text": "Ingredient: Freekeh (فريكة). Category: Grains and pasta | الحبوب والمعكرونة.\nAlso called: فريك.\nProtein: 12 g per 100 g (typical value).\nHow to use freekeh: Roasted green wheat with a smoky taste. Cracked freekeh takes about 2½ times its volume of water and 20 to 25 minutes; whole freekeh about 45 minutes.\nWhere Yara has found freekeh: Carrefour.\nYara recipes that use freekeh: Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس)."
},
{
"file": "yara-ingredients.md",
"title": "Quinoa | كينوا",
"text": "Ingredient: Quinoa (كينوا). Category: Grains and pasta | الحبوب والمعكرونة.\nProtein: 14 g per 100 g (typical value).\nHow to use quinoa: Rinse first to remove the bitter coating. One part quinoa to two parts water, 15 minutes, then rest 5.\nWhere Yara has found quinoa: Carrefour."
},
{
"file": "yara-ingredients.md",
"title": "Rolled oats | شوفان",
"text": "Ingredient: Rolled oats (شوفان). Category: Grains and pasta | الحبوب والمعكرونة.\nAlso called: شوفان.\nProtein: 13 g per 100 g (typical value).\nHow to use rolled oats: Rolled oats cook in about 5 minutes, or soak overnight. Only gluten-free if the pack says so.\nWhere Yara has found rolled oats: Panda.\nYara recipes that use rolled oats: Date and tahini overnight oats (شوفان منقوع بالتمر والطحينة)."
},
{
"file": "yara-ingredients.md",
"title": "Spaghetti | سباغيتي",
"text": "Ingredient: Spaghetti (سباغيتي). Category: Grains and pasta | الحبوب والمعكرونة.\nProtein: 12 g per 100 g (typical value).\nHow to use spaghetti: Dry durum-wheat pasta is usually egg-free. Check the label, especially for fresh or egg pasta.\nWhere Yara has found spaghetti: Carrefour, Panda."
},
{
"file": "yara-ingredients.md",
"title": "Almonds | لوز",
"text": "Ingredient: Almonds (لوز). Category: Nuts, seeds and tahini | المكسرات والبذور والطحينة.\nProtein: 21 g per 100 g (typical value).\nHow to use almonds: Good for calcium and vitamin E. Toast in a dry pan for salads.\nWhere Yara has found almonds: Carrefour.\nYara recipes that use almonds: Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس), Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "Chia seeds | بذور الشيا",
"text": "Ingredient: Chia seeds (بذور الشيا). Category: Nuts, seeds and tahini | المكسرات والبذور والطحينة.\nProtein: 17 g per 100 g (typical value).\nHow to use chia seeds: Soak 1 tablespoon in 3 tablespoons of water for 15 minutes to make a gel, or stir into oats. A plant source of omega-3.\nWhere Yara has found chia seeds: Carrefour."
},
{
"file": "yara-ingredients.md",
"title": "Peanut butter | زبدة الفول السوداني",
"text": "Ingredient: Peanut butter (زبدة الفول السوداني). Category: Nuts, seeds and tahini | المكسرات والبذور والطحينة.\nProtein: 24 g per 100 g (typical value).\nHow to use peanut butter: The best ones are just peanuts and salt. Some brands add honey or whey, so check the label.\nWhere Yara has found peanut butter: Panda.\nYara recipes that use peanut butter: Peanut butter and date toast (خبز محمص بزبدة الفول السوداني والتمر)."
},
{
"file": "yara-ingredients.md",
"title": "Peanuts (roasted) | فول سوداني محمص",
"text": "Ingredient: Peanuts (roasted) (فول سوداني محمص). Category: Nuts, seeds and tahini | المكسرات والبذور والطحينة.\nProtein: 24 g per 100 g (typical value).\nHow to use peanuts (roasted): One of the cheapest protein snacks. Choose unsalted for everyday eating.\nWhere Yara has found peanuts (roasted): Carrefour."
},
{
"file": "yara-ingredients.md",
"title": "Pumpkin seeds (shelled) | بذور اليقطين المقشرة",
"text": "Ingredient: Pumpkin seeds (shelled) (بذور اليقطين المقشرة). Category: Nuts, seeds and tahini | المكسرات والبذور والطحينة.\nAlso called: بذر القرع.\nProtein: 30 g per 100 g (typical value).\nHow to use pumpkin seeds (shelled): Among the highest-protein seeds. Toast lightly and sprinkle on salads or oats.\nWhere Yara has found pumpkin seeds (shelled): Carrefour."
},
{
"file": "yara-ingredients.md",
"title": "Sesame seeds | سمسم",
"text": "Ingredient: Sesame seeds (سمسم). Category: Nuts, seeds and tahini | المكسرات والبذور والطحينة.\nProtein: 18 g per 100 g (typical value).\nHow to use sesame seeds: Toast lightly before using. Sprinkle on oats, salads and bread.\nWhere Yara has found sesame seeds: Carrefour, LuLu.\nYara recipes that use sesame seeds: Date and tahini overnight oats (شوفان منقوع بالتمر والطحينة)."
},
{
"file": "yara-ingredients.md",
"title": "Tahini | طحينة",
"text": "Ingredient: Tahini (طحينة). Category: Nuts, seeds and tahini | المكسرات والبذور والطحينة.\nAlso called: طحينية.\nProtein: 17 g per 100 g (typical value).\nHow to use tahini: Ground sesame paste. Stir the oil back in before using and keep it somewhere cool. Adds calcium and protein to sauces, oats and dips.\nWhere Yara has found tahini: Carrefour, LuLu, Panda.\nYara recipes that use tahini: Chickpea kabsa bowl (طبق الحمص بنكهة الكبسة), Foul with tahini and herbs (فول بالطحينة والأعشاب), Date and tahini overnight oats (شوفان منقوع بالتمر والطحينة), Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة), Smooth hummus (حمص بالطحينة)."
},
{
"file": "yara-ingredients.md",
"title": "Almond milk | حليب اللوز",
"text": "Ingredient: Almond milk (حليب اللوز). Category: Plant milks | الحليب النباتي.\nProtein: 0.5 g per 100 g (typical value).\nHow to use almond milk: Low in protein and calories. Pick one fortified with calcium and vitamin B12.\nWhere Yara has found almond milk: Carrefour.\nYara recipes that use almond milk: Date and tahini overnight oats (شوفان منقوع بالتمر والطحينة)."
},
{
"file": "yara-ingredients.md",
"title": "Oat milk | حليب الشوفان",
"text": "Ingredient: Oat milk (حليب الشوفان). Category: Plant milks | الحليب النباتي.\nProtein: 0.5 g per 100 g (typical value).\nHow to use oat milk: Low in protein. If it replaces dairy milk, pick one fortified with calcium and vitamin B12.\nWhere Yara has found oat milk: Carrefour."
},
{
"file": "yara-ingredients.md",
"title": "Arabic bread (white) | خبز عربي أبيض",
"text": "Ingredient: Arabic bread (white) (خبز عربي أبيض). Category: Bread | الخبز.\nAlso called: خبز لبناني، خبز صامولي.\nProtein: not a main protein source.\nHow to use arabic bread (white): Cheap and filling. Most plain Arabic bread is vegan, but some recipes use milk, so check the label.\nWhere Yara has found arabic bread (white): Carrefour, Panda.\nYara recipes that use arabic bread (white): Foul with tahini and herbs (فول بالطحينة والأعشاب), Peanut butter and date toast (خبز محمص بزبدة الفول السوداني والتمر)."
},
{
"file": "yara-ingredients.md",
"title": "Brown tortilla wraps | خبز تورتيلا أسمر",
"text": "Ingredient: Brown tortilla wraps (خبز تورتيلا أسمر). Category: Bread | الخبز.\nProtein: not a main protein source.\nHow to use brown tortilla wraps: Check the label for milk or whey.\nWhere Yara has found brown tortilla wraps: Carrefour, Panda.\nYara recipes that use brown tortilla wraps: Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة), Spiced lentil wraps (لفائف العدس المتبّل)."
},
{
"file": "yara-ingredients.md",
"title": "Avocado | أفوكادو",
"text": "Ingredient: Avocado (أفوكادو). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use avocado: Healthy fats. Good on beans and rice.\nWhere Yara has found avocado: Carrefour, LuLu, Panda.\nYara recipes that use avocado: Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Carrots | جزر",
"text": "Ingredient: Carrots (جزر). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use carrots: Adds sweetness and color to soups and stews.\nWhere Yara has found carrots: Carrefour, LuLu, Panda.\nYara recipes that use carrots: Chickpeas and spinach sauté (حمص مع السبانخ)."
},
{
"file": "yara-ingredients.md",
"title": "Celery | كرفس",
"text": "Ingredient: Celery (كرفس). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use celery: Adds savory depth to soups and stews.\nWhere Yara has found celery: Carrefour, LuLu.\nYara recipes that use celery: Lentil vegetable soup (شوربة العدس بالخضار), Chickpeas and spinach sauté (حمص مع السبانخ)."
},
{
"file": "yara-ingredients.md",
"title": "Coriander leaves | كزبرة خضراء",
"text": "Ingredient: Coriander leaves (كزبرة خضراء). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use coriander leaves: Fresh coriander (cilantro), bought by the bunch.\nWhere Yara has found coriander leaves: LuLu, Panda.\nYara recipes that use coriander leaves: Lentil kabsa (كبسة العدس), Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Cucumbers | خيار",
"text": "Ingredient: Cucumbers (خيار). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use cucumbers: For salads, and with hummus or foul at breakfast.\nWhere Yara has found cucumbers: Carrefour, LuLu, Panda.\nYara recipes that use cucumbers: Mujaddara with cucumber salad (مجدرة مع سلطة الخيار), Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "Dates | تمر",
"text": "Ingredient: Dates (تمر). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: 2 g per 100 g (typical value).\nHow to use dates: A natural sweetener for oats, smoothies and snacks. Khalas and Sukkari are common, affordable varieties.\nWhere Yara has found dates: Carrefour, LuLu.\nYara recipes that use dates: Date and tahini overnight oats (شوفان منقوع بالتمر والطحينة), Peanut butter and date toast (خبز محمص بزبدة الفول السوداني والتمر)."
},
{
"file": "yara-ingredients.md",
"title": "Garlic | ثوم",
"text": "Ingredient: Garlic (ثوم). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use garlic: Buy loose by weight for the best price.\nWhere Yara has found garlic: Carrefour, LuLu, Panda.\nYara recipes that use garlic: Foul with tahini and herbs (فول بالطحينة والأعشاب), Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة), Smooth hummus (حمص بالطحينة), Lentil vegetable soup (شوربة العدس بالخضار), Spiced lentil wraps (لفائف العدس المتبّل), Chickpeas and spinach sauté (حمص مع السبانخ), Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Green bell pepper | فلفل رومي أخضر",
"text": "Ingredient: Green bell pepper (فلفل رومي أخضر). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use green bell pepper: Adds vitamin C to bean dishes, which helps iron absorption.\nWhere Yara has found green bell pepper: Carrefour, LuLu, Panda.\nYara recipes that use green bell pepper: Chickpea kabsa bowl (طبق الحمص بنكهة الكبسة), Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة), Spiced lentil wraps (لفائف العدس المتبّل), Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار), Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Green onions | بصل أخضر",
"text": "Ingredient: Green onions (بصل أخضر). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nAlso called: بصل أخضر.\nProtein: not a main protein source.\nHow to use green onions: Bought by the bunch; for salads.\nWhere Yara has found green onions: LuLu, Panda.\nYara recipes that use green onions: Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "Lemons | ليمون",
"text": "Ingredient: Lemons (ليمون). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use lemons: Its vitamin C helps the body absorb iron from beans and lentils, which is one reason Saudi cooking pairs them so well.\nWhere Yara has found lemons: Carrefour, LuLu, Panda.\nYara recipes that use lemons: Lentil kabsa (كبسة العدس), Chickpea kabsa bowl (طبق الحمص بنكهة الكبسة), Foul with tahini and herbs (فول بالطحينة والأعشاب), Mujaddara with cucumber salad (مجدرة مع سلطة الخيار), Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة), Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس), Smooth hummus (حمص بالطحينة), Lentil vegetable soup (شوربة العدس بالخضار), Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار), Chickpeas and spinach sauté (حمص مع السبانخ)."
},
{
"file": "yara-ingredients.md",
"title": "Mint | نعناع",
"text": "Ingredient: Mint (نعناع). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use mint: Bought by the bunch; for salads and tea.\nWhere Yara has found mint: LuLu, Panda.\nYara recipes that use mint: Mujaddara with cucumber salad (مجدرة مع سلطة الخيار)."
},
{
"file": "yara-ingredients.md",
"title": "Onions | بصل",
"text": "Ingredient: Onions (بصل). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use onions: The base of most savory dishes here. A bag is the cheapest way to buy.\nWhere Yara has found onions: Carrefour, LuLu, Panda.\nYara recipes that use onions: Lentil kabsa (كبسة العدس), Mujaddara with cucumber salad (مجدرة مع سلطة الخيار), Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس), Lentil vegetable soup (شوربة العدس بالخضار), Chickpeas and spinach sauté (حمص مع السبانخ), Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Parsley | بقدونس",
"text": "Ingredient: Parsley (بقدونس). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use parsley: Bought by the bunch; very cheap.\nWhere Yara has found parsley: LuLu, Panda.\nYara recipes that use parsley: Foul with tahini and herbs (فول بالطحينة والأعشاب), Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة), Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس)."
},
{
"file": "yara-ingredients.md",
"title": "Spinach | سبانخ",
"text": "Ingredient: Spinach (سبانخ). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nAlso called: سبانخ، بالاك.\nProtein: not a main protein source.\nHow to use spinach: Rich in folate and iron. Eat with lemon or tomato to absorb more of the iron. Frozen spinach works in cooked dishes.\nWhere Yara has found spinach: LuLu.\nYara recipes that use spinach: Chickpeas and spinach sauté (حمص مع السبانخ)."
},
{
"file": "yara-ingredients.md",
"title": "Tomatoes | طماطم",
"text": "Ingredient: Tomatoes (طماطم). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nProtein: not a main protein source.\nHow to use tomatoes: Its vitamin C helps the body absorb iron from beans and lentils.\nWhere Yara has found tomatoes: Carrefour, LuLu, Panda.\nYara recipes that use tomatoes: Lentil kabsa (كبسة العدس), Foul with tahini and herbs (فول بالطحينة والأعشاب), Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار), Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Zucchini | كوسة",
"text": "Ingredient: Zucchini (كوسة). Category: Fruit, vegetables and herbs | الخضار والفواكه والأعشاب.\nAlso called: كوسا.\nProtein: not a main protein source.\nHow to use zucchini: Roast or stuff it; cooks quickly.\nWhere Yara has found zucchini: Carrefour, LuLu, Panda.\nYara recipes that use zucchini: Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة)."
},
{
"file": "yara-ingredients.md",
"title": "Cardamom | هيل",
"text": "Ingredient: Cardamom (هيل). Category: Pantry | مؤونة المطبخ.\nAlso called: هيل.\nProtein: not a main protein source.\nHow to use cardamom: For Arabic coffee, rice and oats. Buying whole and grinding keeps it fresh.\nWhere Yara has found cardamom: Carrefour, LuLu, Panda.\nYara recipes that use cardamom: Date and tahini overnight oats (شوفان منقوع بالتمر والطحينة), Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس)."
},
{
"file": "yara-ingredients.md",
"title": "Chili powder | شطة مطحونة",
"text": "Ingredient: Chili powder (شطة مطحونة). Category: Pantry | مؤونة المطبخ.\nProtein: not a main protein source.\nHow to use chili powder: Spice mixes vary: some kabsa and bharat mixes contain chicken stock powder, so check the label.\nWhere Yara has found chili powder: Carrefour, LuLu.\nYara recipes that use chili powder: Crunchy roasted chickpeas (حمص محمص مقرمش), Spiced lentil wraps (لفائف العدس المتبّل)."
},
{
"file": "yara-ingredients.md",
"title": "Chopped tomatoes (canned) | طماطم مقطعة معلبة",
"text": "Ingredient: Chopped tomatoes (canned) (طماطم مقطعة معلبة). Category: Pantry | مؤونة المطبخ.\nProtein: not a main protein source.\nHow to use chopped tomatoes (canned): Use in soups and stews when tomato sauce isn't available.\nWhere Yara has found chopped tomatoes (canned): LuLu, Panda.\nYara recipes that use chopped tomatoes (canned): Lentil vegetable soup (شوربة العدس بالخضار), Chickpeas and spinach sauté (حمص مع السبانخ)."
},
{
"file": "yara-ingredients.md",
"title": "Date syrup | دبس التمر",
"text": "Ingredient: Date syrup (دبس التمر). Category: Pantry | مؤونة المطبخ.\nAlso called: دبس.\nProtein: not a main protein source.\nHow to use date syrup: A local sweetener for dressings, oats and tahini (dibs w tahini).\nWhere Yara has found date syrup: Carrefour, Panda.\nYara recipes that use date syrup: Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "Extra virgin olive oil | زيت زيتون بكر ممتاز",
"text": "Ingredient: Extra virgin olive oil (زيت زيتون بكر ممتاز). Category: Pantry | مؤونة المطبخ.\nProtein: not a main protein source.\nHow to use extra virgin olive oil: For dressings and finishing. Vegetable oil is cheaper for frying.\nWhere Yara has found extra virgin olive oil: Carrefour, LuLu, Panda.\nYara recipes that use extra virgin olive oil: Mujaddara with cucumber salad (مجدرة مع سلطة الخيار), Roasted vegetable tahini wrap (لفائف الخضار المشوية بالطحينة), Smooth hummus (حمص بالطحينة), Crunchy roasted chickpeas (حمص محمص مقرمش), Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "Ground black pepper | فلفل أسود مطحون",
"text": "Ingredient: Ground black pepper (فلفل أسود مطحون). Category: Pantry | مؤونة المطبخ.\nProtein: not a main protein source.\nHow to use ground black pepper: Buy loose or in small packs; it loses aroma over time.\nWhere Yara has found ground black pepper: Carrefour, LuLu, Panda.\nYara recipes that use ground black pepper: Mujaddara with cucumber salad (مجدرة مع سلطة الخيار), Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس), Lentil vegetable soup (شوربة العدس بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "Ground cumin | كمون مطحون",
"text": "Ingredient: Ground cumin (كمون مطحون). Category: Pantry | مؤونة المطبخ.\nProtein: not a main protein source.\nHow to use ground cumin: Goes with almost every bean and lentil dish here.\nWhere Yara has found ground cumin: Carrefour, LuLu, Panda.\nYara recipes that use ground cumin: Lentil kabsa (كبسة العدس), Foul with tahini and herbs (فول بالطحينة والأعشاب), Mujaddara with cucumber salad (مجدرة مع سلطة الخيار), Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس), Smooth hummus (حمص بالطحينة), Crunchy roasted chickpeas (حمص محمص مقرمش), Spiced lentil wraps (لفائف العدس المتبّل), Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "Tomato paste | معجون طماطم",
"text": "Ingredient: Tomato paste (معجون طماطم). Category: Pantry | مؤونة المطبخ.\nProtein: not a main protein source.\nHow to use tomato paste: Concentrated tomato for kabsa-style dishes and stews.\nWhere Yara has found tomato paste: LuLu.\nYara recipes that use tomato paste: Chickpea kabsa bowl (طبق الحمص بنكهة الكبسة), Spiced lentil wraps (لفائف العدس المتبّل)."
},
{
"file": "yara-ingredients.md",
"title": "Vegetable oil | زيت نباتي",
"text": "Ingredient: Vegetable oil (زيت نباتي). Category: Pantry | مؤونة المطبخ.\nProtein: not a main protein source.\nHow to use vegetable oil: For everyday cooking and frying.\nWhere Yara has found vegetable oil: LuLu, Panda.\nYara recipes that use vegetable oil: Lentil kabsa (كبسة العدس), Chickpea kabsa bowl (طبق الحمص بنكهة الكبسة), Freekeh with chickpeas and parsley (فريكة بالحمص والبقدونس), Lentil vegetable soup (شوربة العدس بالخضار), Chickpeas and spinach sauté (حمص مع السبانخ), Red beans and rice (فاصوليا حمراء مع الأرز)."
},
{
"file": "yara-ingredients.md",
"title": "White vinegar | خل أبيض",
"text": "Ingredient: White vinegar (خل أبيض). Category: Pantry | مؤونة المطبخ.\nProtein: not a main protein source.\nHow to use white vinegar: For dressings and pickles; lemon juice works instead in most recipes.\nWhere Yara has found white vinegar: Carrefour, LuLu, Panda.\nYara recipes that use white vinegar: Garden white bean salad (سلطة الفاصوليا البيضاء بالخضار)."
},
{
"file": "yara-ingredients.md",
"title": "Ingredients Yara does not track yet | مكونات لا تتابعها يارا بعد",
"text": "Yara has not found these in LuLu, Carrefour or Panda yet. Do not say they are available or give a price for them:\n- Tofu (توفو): Look in Tamimi, Danube, and the Asian food aisles of LuLu and Carrefour.\n- Soya chunks (قطع فول الصويا): Usually in Indian grocery sections (sold as soya chunks or soya wadi). Very high protein per riyal.\n- Soy milk (حليب الصويا): The highest-protein plant milk. Check the plant-milk shelves and pick a calcium- and B12-fortified one.\n- Edamame (إدامامي): Usually frozen, in larger supermarkets."
},
{
"file": "yara-ingredients.md",
"title": "Check the label for animal ingredients | اقرأ المكونات",
"text": "Most foods in this guide are plant-based by nature. These vary by brand, so check the ingredients:\n- Bread and tortillas: milk or milk powder.\n- Pasta: egg, especially fresh pasta.\n- Peanut butter and spreads: honey or whey.\n- Stock cubes and spice mixes: chicken fat or chicken flavor, common in kabsa seasonings.\n- Sweets and jellies: gelatin.\n- Words that mean an animal ingredient: whey, casein, lactose, milk solids, ghee or samn, gelatin, albumin (egg), carmine or E120, shellac or E904."
},
{
"file": "yara-ingredients.md",
"title": "Nutrients to plan for on a vegan diet | عناصر غذائية تحتاج تخطيطًا",
"text": "- Vitamin B12 isn't reliably found in plant foods. Get it from fortified plant milk or cereal, or a supplement.\n- Vitamin D deficiency is common in Saudi Arabia, plant-based or not. A doctor can test for it.\n- Iron from beans and lentils is absorbed better with vitamin C, so the lemon and tomato in Saudi cooking help.\n- Calcium: tahini, almonds, and calcium-fortified plant milk. Omega-3: chia seeds and walnuts.\n- This is general information, not medical advice."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "Vegan main dishes and soups from USDA MyPlate Kitchen (list) | أطباق رئيسية وشوربات نباتية",
"text": "Vegan recipes published by the USDA and written by U.S. universities, health departments and the USDA. Use this list for requests such as: vegan recipes, healthy recipes, bean recipes, lentil recipes, tofu recipes, soups, salads, chili, breakfast ideas, وصفات نباتية، وصفات صحية، وصفات بقوليات. Copy recipe names exactly.\n\n- Garden Cannellini Bean Salad | سلطة الفاصوليا البيضاء بالخضار (main salad, 20.2 g protein, 409 kcal per serving)\n- Crusty Rice with Tofu and Vegetables | أرز مقرمش بالتوفو والخضار (main dish, 19.3 g protein, 425 kcal per serving)\n- Lentil Barley Soup | شوربة العدس والشعير (soup, 19 g protein, 330 kcal per serving)\n- Red Beans and Rice | فاصوليا حمراء مع الأرز (main dish, 17.5 g protein, 479 kcal per serving)\n- Tofu with Broccoli | توفو مع البروكلي (main dish, 16 g protein, 206 kcal per serving)\n- Veggie Bean Wrap | لفافة الخضار والفاصوليا (main dish, 15 g protein, 458 kcal per serving)\n- Lentil Tacos | تاكو العدس (main dish, 14 g protein, 193 kcal per serving)\n- Hearty Mexican Soup | شوربة مكسيكية بالفاصوليا السوداء (soup, 13.2 g protein, 249 kcal per serving)\n- Peanut Stew | يخنة الفول السوداني بالبطاطس (main dish, 12 g protein, 353 kcal per serving)\n- Rainbow Bell Pepper Boats with Garbanzo Beans and Kale | فلفل ملوّن محشي بالحمص والكيل (main dish, 11.6 g protein, 347 kcal per serving)\n- Vegetarian Chili | تشيلي نباتي بالخضار والفاصوليا (main dish, 11.5 g protein, 276 kcal per serving)\n- Curried Squash Stew | يخنة القرع بالكاري (main dish, 11 g protein, 240 kcal per serving)\n- Baked Tofu | توفو مخبوز (protein for any meal, 10.7 g protein, 99 kcal per serving)\n- Chickpeas and Spinach Sauté | حمص مع السبانخ (main dish, 9.7 g protein, 193 kcal per serving)\n- Lentil Vegetable Soup | شوربة العدس بالخضار (soup, 9 g protein, 163 kcal per serving)\n- Quinoa and Black Bean Salad | سلطة الكينوا والفاصوليا السوداء (main salad, 7 g protein, 167 kcal per serving)\n- 3-Can Chili | تشيلي العلب الثلاث (main dish, 6.5 g protein, 126 kcal per serving)\n- Lentil Stew | يخنة العدس (main dish, 6 g protein, 113 kcal per serving)\n- Caribbean Casserole | طاجن كاريبي بالأرز والفاصوليا (main dish, 5.8 g protein, 182 kcal per serving)\n- Farmers Market Gazpacho | غازباتشو الخضار (شوربة باردة) (cold soup, 5.4 g protein, 138 kcal per serving)"
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "Vegan breakfasts, salads, sides and snacks from USDA MyPlate Kitchen (list) | فطور وسلطات وأطباق جانبية ووجبات خفيفة نباتية",
"text": "Vegan recipes published by the USDA and written by U.S. universities, health departments and the USDA. Use this list for requests such as: vegan recipes, healthy recipes, bean recipes, lentil recipes, tofu recipes, soups, salads, chili, breakfast ideas, وصفات نباتية، وصفات صحية، وصفات بقوليات. Copy recipe names exactly.\n\n- White Bean Bruschetta | بروسكيتا الفاصوليا البيضاء (side or appetizer, 10.2 g protein, 341 kcal per serving)\n- Butternut Squash with Black Beans | قرع عسلي مع الفاصوليا السوداء (side dish, 9.6 g protein, 173 kcal per serving)\n- Overnight Oatmeal | شوفان منقوع طوال الليل (breakfast, 8 g protein, 333 kcal per serving)\n- Simmered Beans | فاصوليا مطهوة على نار هادئة (side dish, 7 g protein, 113 kcal per serving)\n- Eggplant Stir Fry | باذنجان مقلّب بالخضار (side dish, 7 g protein, 238 kcal per serving)\n- Dave's Herb-Stuffed Mushrooms | فطر محشي بالأعشاب والحمص (side or appetizer, 5.1 g protein, 135 kcal per serving)\n- Confetti Grain Salad | سلطة الأرز البني الملونة (side salad, 4.4 g protein, 233 kcal per serving)\n- Spring Vegetable Sauté | خضار الربيع المقلّبة (side dish, 4.1 g protein, 138 kcal per serving)\n- Hummus | حمص بالطحينة (snack or dip, 4 g protein, 117 kcal per serving)\n- Rise and Shine Cobbler | كوبلر الفواكه للصباح (breakfast or dessert, 3.7 g protein, 217 kcal per serving)\n- Baked Tortilla Chips | رقائق تورتيلا مخبوزة (snack, 3.5 g protein, 111 kcal per serving)\n- Pumpkin Chocolate Muffins | مافن اليقطين بالشوكولاتة (snack or dessert, 2 g protein, 89 kcal per serving)\n- Sautéed Cabbage and Onion | ملفوف وبصل مقلّب (side dish, 1.8 g protein, 53 kcal per serving)\n- Corn and Cucumber Salad | سلطة الذرة والخيار (side salad, 1 g protein, 27 kcal per serving)\n- Tropical Morning Treat | سلطة فواكه استوائية للصباح (breakfast or snack, 0.8 g protein, 88 kcal per serving)"
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "Measurements and sources for the MyPlate Kitchen recipes | الوحدات والمصادر",
"text": "Source: Recipes from the U.S. Department of Agriculture's MyPlate Kitchen (public domain), taken from the USDA's own pages or from the edition preserved by MyPlate.food (reused with credit for non-profit work), as noted on each recipe. Ingredients and directions are exactly as published.\nThe recipes use American units. 1 cup is about 240 ml; 1 tablespoon is 15 ml; 1 teaspoon is 5 ml; 1 ounce is about 28 g; 1 pound is about 450 g. A 15 to 16 ounce can is about 425 to 450 g, so a standard 400 g can from a Saudi supermarket works. 350 °F is about 175 °C, 375 °F about 190 °C, 400 °F about 200 °C.\nSome ingredients vary by brand: tortillas, bread, bread crumbs and granola can contain milk, butter, honey or egg. Buy vegan versions."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Tropical Morning Treat | سلطة فواكه استوائية للصباح",
"text": "Vegan recipe: Tropical Morning Treat (Arabic name: سلطة فواكه استوائية للصباح). Type: breakfast or snack. Makes 4 servings; serving size: 1/2 cup, 1/4 of recipe (114g).\nNutrition per serving (USDA panel): 88 kcal, 0.8 g protein, 2.5 g fiber.\nAbout: Enjoy this tasty fruit dish in the morning or as a snack anytime of the day.\n\nIngredients for Tropical Morning Treat:\n- 1/4 cup orange juice\n- 1 apple\n- 1 orange\n- 1 banana\n\nDirections for Tropical Morning Treat:\n1. Wash hands with soap and water.\n2. Place orange juice in bowl.\n3. Wash apple and dry.\n4. Remove the seeds and dice.\n5. Coat apple surfaces with orange juice to prevent browning.\n6. Peel orange and break into sections.\n7. Cut sections into small pieces.\n8. Peel and slice banana into 1/4 inch circles.\n9. Combine all fruit and orange juice lightly in a bowl and mix together.\n10. Chill or serve immediately.\n\nSource: recipe by University of Wyoming Extension, Cent$ible Nutrition Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/tropical-morning-treat), public domain. Edition: MyPlate.food, https://myplate.food/recipes/tropical-morning-treat."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Corn and Cucumber Salad | سلطة الذرة والخيار",
"text": "Vegan recipe: Corn and Cucumber Salad (Arabic name: سلطة الذرة والخيار). Type: side salad. Makes 7 servings; serving size: 1/2 cup prepared vegetables, 1/7 of recipe.\nNutrition per serving (USDA panel): 27 kcal, 1 g protein, 1 g fiber.\nAbout: Spices and red wine vinegar dress up the vegetables in this recipe. Enjoy as a side dish with your favorite entree.\n\nIngredients for Corn and Cucumber Salad:\n- 1 cup cucumber with peel, chopped\n- 1 cup low-sodium canned corn\n- 1 cup cherry tomatoes, chopped\n- 1/8 cup red pepper, chopped (2 Tablespoons)\n- 1/8 cup green pepper, chopped (2 Tablespoons)\n- 2 tablespoons red wine vinegar\n- 1/2 teaspoon garlic powder\n- 1/2 teaspoon ground cumin\n- 1/4 teaspoon dried cilantro or coriander\n- 1/8 teaspoon ground black pepper\n\nDirections for Corn and Cucumber Salad:\n1. Wash hands with soap and water.\n2. Combine ingredients and mix well.\n3. Serve cold.\n\nSource: recipe by ScaleDown Publishing, Inc.. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/corn-and-cucumber-salad), public domain. Edition: MyPlate.food, https://myplate.food/recipes/corn-and-cucumber-salad."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Farmers Market Gazpacho | غازباتشو الخضار (شوربة باردة)",
"text": "Vegan recipe: Farmers Market Gazpacho (Arabic name: غازباتشو الخضار (شوربة باردة)). Type: cold soup. Makes 4 servings; serving size: 1/4 of recipe.\nNutrition per serving (USDA panel): 138 kcal, 5.4 g protein, 7.7 g fiber.\nAbout: Garlic, cumin, and lemon juice give a zesty flavor to this cold, blended vegetable soup. Cilantro added at the end leaves a refreshing pop of flavor.\n\nIngredients for Farmers Market Gazpacho:\n- 2 medium cucumbers, diced into 1/4 inch pieces\n- 3 medium red bell peppers, seeded and diced into 1/4 inch pieces\n- 3 medium green peppers, seeded and diced into 1/4 inch pieces\n- 4 medium celery stalks, diced into 1/4 inch pieces\n- 2 medium tomatoes, diced into 1/4 inch pieces\n- 1 medium onion, diced into 1/4 inch pieces\n- 2 cups low-sodium tomato juice\n- 3 garlic cloves, minced\n- 1 tablespoon ground cumin\n- 1 cup fresh cilantro, chopped\n- salt and pepper (to taste, optional)\n- 2 lemons, juiced\n\nDirections for Farmers Market Gazpacho:\n1. Wash hands with soap and water.\n2. Combine all ingredients except salt, pepper, and lemons in a bowl.\n3. Remove 2 cups of the mixture and reserve.\n4. Using a blender or food processor, puree the remaining mixture in the bowl.\n5. Add 2 cups of reserved mixture to the pureed mixture.\n6. Season with salt, pepper (optional) and the juice from the lemons.\n7. Cover mixture and refrigerate for at least 2 hours before serving.\n8. Serve cold, garnished with chopped cilantro.\n\nSource: recipe by Veggin' Out Recipe Book, Johnson and Wales University and Rhode Island Department of Health WIC Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/farmers-market-gazpacho), public domain. Edition: MyPlate.food, https://myplate.food/recipes/farmers-market-gazpacho."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Confetti Grain Salad | سلطة الأرز البني الملونة",
"text": "Vegan recipe: Confetti Grain Salad (Arabic name: سلطة الأرز البني الملونة). Type: side salad. Makes 8 servings; serving size: 3/4 cup prepared salad.\nNutrition per serving (USDA panel): 233 kcal, 4.4 g protein, 3.6 g fiber.\nAbout: Try this recipe with a variety of vegetables until you find what you and your family like best.\n\nIngredients for Confetti Grain Salad:\n- 1 1/2 cups brown rice, uncooked\n- 3 cups water\n- 2 lemons, juiced\n- 3 green onions (scallions)\n- 1/4 cup fresh parsley, minced\n- 1/2 teaspoon salt\n- 1 dash black pepper\n- 1/4 cup olive oil (or cooking oil of choice)\n- 1 1/2 cups mixed vegetables, cut into small pieces\n\nDirections for Confetti Grain Salad:\n1. Wash hands with soap and water.\n2. Wash rice and put into a 2-quart pot with water.\n3. Bring to boil, then lower heat to simmer, and cook uncovered until all the water is absorbed (approximately 45 minutes). Pour into medium sized bowl and allow to cool.\n4. Pour lemon juice over rice and stir.\n5. When rice is cooled to lukewarm, add vegetables, salt, pepper, and oil.\n6. Stir and chill at least 1 hour.\n7. This dish also can be served warm.\n\nSource: recipe by Cent$ible Nutrition Cookbook, University of Wyoming Cooperative Extension, Cent$ible Nutrition Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/confetti-grain-salad), public domain. Edition: MyPlate.food, https://myplate.food/recipes/confetti-grain-salad."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Rise and Shine Cobbler | كوبلر الفواكه للصباح",
"text": "Vegan recipe: Rise and Shine Cobbler (Arabic name: كوبلر الفواكه للصباح). Type: breakfast or dessert. Makes 4 servings; serving size: 1/4 of recipe (201g).\nNutrition per serving (USDA panel): 217 kcal, 3.7 g protein, 5.4 g fiber.\nAbout: This cobbler can be made quickly in the microwave. Enjoy this tasty treat for breakfast or as a sweet dessert.\n\nIngredients for Rise and Shine Cobbler:\n- 1 cup peaches (canned, drained and sliced)\n- 1 cup pear halves (canned, drained and sliced)\n- 6 prunes (pitted, each cut in half)\n- 1/4 teaspoon vanilla extract\n- 1 orange\n- 1 cup granola, low-fat\n\nDirections for Rise and Shine Cobbler:\n1. Wash hands with soap and water.\n2. In a large microwave-safe bowl, mix peaches, pears, prunes, and vanilla extract.\n3. Rub an orange against a grater to remove 1 teaspoon of the orange peel.\n4. Then, cut the orange in half and squeeze 1/4 cup orange juice.\n5. Add orange peel and juice to fruit mixture.\n6. Stir.\n7. Top with granola.\n8. Microwave on high for 5 minutes.\n9. Let stand for 2 minutes.\n10. Spoon into 4 bowls and serve warm.\nCheck the label: Granola varies by brand: some contain honey or milk. Buy a vegan one.\n\nSource: recipe by Kids... Get Cooking!, California Department of Health Services, California Children's 5-A-Day Power Play Campaign. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/rise-and-shine-cobbler), public domain. Edition: MyPlate.food, https://myplate.food/recipes/rise-and-shine-cobbler."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: 3-Can Chili | تشيلي العلب الثلاث",
"text": "Vegan recipe: 3-Can Chili (Arabic name: تشيلي العلب الثلاث). Type: main dish. Makes 6 servings; serving size: 1/6 of recipe, 1 cup.\nNutrition per serving (USDA panel): 126 kcal, 6.5 g protein, 7.8 g fiber.\nAbout: With almost no cooking required to prepare this chili, just open cans of beans, corn, and tomatoes, and heat everything together in a pan!\n\nIngredients for 3-Can Chili:\n- 1 can (15.5 ounces) low-sodium black beans, undrained (or pinto, kidney, or red beans)\n- 1 can (15.2 ounces) reduced sodium corn, drained (or 10-oz package of frozen corn)\n- 1 can (14.5 ounces) low-sodium crushed tomatoes, undrained\n- 1 teaspoon chili powder (or more, to taste)\n\nDirections for 3-Can Chili:\n1. Wash hands with soap and water.\n2. Place the contents of all 3 cans into a pan.\n3. Add chili powder to taste.\n4. Stir to mix.\n5. Continue to stir over medium heat until heated thoroughly.\n6. Refrigerate leftovers.\n\nSource: recipe by Adapted from Eating Smart, Being Active, Colorado State University and University of California at Davis. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/3-can-chili), public domain. Edition: MyPlate.food, https://myplate.food/recipes/3-can-chili."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Vegetarian Chili | تشيلي نباتي بالخضار والفاصوليا",
"text": "Vegan recipe: Vegetarian Chili (Arabic name: تشيلي نباتي بالخضار والفاصوليا). Type: main dish. Makes 4 servings; serving size: 1/4 of recipe.\nNutrition per serving (USDA panel): 276 kcal, 11.5 g protein, 14.5 g fiber.\nAbout: This delicious chili packed full of veggies, beans, and spices is fast enough for a weeknight dinner. Top with cilantro for a boost of flavor.\n\nIngredients for Vegetarian Chili:\n- 2 tablespoons vegetable oil (or cooking oil of choice)\n- 2 large onions, cut into 1/4-inch pieces\n- 1 medium green bell pepper, cut into 1/4-inch pieces\n- 3 garlic cloves, chopped\n- 2 jalapeno chilis, diced\n- 1 tablespoon chili powder\n- 1 tablespoon ground cumin\n- 1 cup cilantro, chopped, divided\n- salt and pepper (to taste, optional)\n- 2 cans (14.5 ounces each) low-sodium whole tomatoes, cut into 1/4-inch pieces (or 8 medium fresh tomatoes)\n- 2 medium zucchini, cut into 1/4-inch pieces\n- 2 medium summer squash, cut into 1/4-inch pieces\n- 1 can (15.5 ounces) low-sodium kidney beans, rinsed\n\nDirections for Vegetarian Chili:\n1. Wash hands with soap and water.\n2. Add oil to a large pot and sauté onions, bell pepper, garlic, and jalapeno over medium-high heat for about 5 minutes, stirring often.\n3. Add chili powder, cumin, half of the chopped cilantro, salt, and pepper, and continue cooking for another 3 minutes, stirring occasionally.\n4. Add the tomatoes, zucchini, and squash.\n5. Bring mixture to a simmer.\n6. Simmer for 15 minutes, stirring occasionally.\n7. Add beans, and continue to simmer for another 5 minutes.\n8. Serve the mixture hot.\n9. Put remaining cilantro on top.\n\nSource: recipe by Veggin' Out Recipe Book, Johnson and Wales University and Rhode Island Department of Health WIC Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/vegetarian-chili), public domain. Edition: MyPlate.food, https://myplate.food/recipes/vegetarian-chili."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Dave's Herb-Stuffed Mushrooms | فطر محشي بالأعشاب والحمص",
"text": "Vegan recipe: Dave's Herb-Stuffed Mushrooms (Arabic name: فطر محشي بالأعشاب والحمص). Type: side or appetizer. Makes 4 servings; serving size: 2 stuffed mushrooms.\nNutrition per serving (USDA panel): 135 kcal, 5.1 g protein, 3.8 g fiber.\nAbout: Mushrooms stuffed with chickpeas, sun-dried tomatoes, herbs and spices instead of fatty, salty fillings.\n\nIngredients for Dave's Herb-Stuffed Mushrooms:\n- 8 large mushrooms (approx. 3 inches in diameter)\n- 4 cloves garlic\n- 3/4 cup white onions\n- 3 teaspoons olive oil\n- 1/2 teaspoon dried parsley\n- 1/2 teaspoon dried sage\n- 1/2 teaspoon dried rosemary\n- 1/2 teaspoon dried thyme\n- 1/4 cup bread crumbs (whole-wheat if available)\n- 1/4 cup sun-dried tomatoes (chopped fine)\n- 3/4 cup canned, drained, no-salt added chickpeas (garbanzo beans)\n- 1 teaspoon lemon juice\n- cooking spray\n\nDirections for Dave's Herb-Stuffed Mushrooms:\n1. Preheat oven to 375 °F (190 °C). Clean mushrooms with a paper towel or vegetable brush; remove stems to use for the filling.\n2. While oven is warming, put mushroom caps (open side down) in oven for 10 minutes. This will prepare the caps for stuffing.\n3. Chop the garlic and onions and sauté with 1 teaspoon of olive oil.\n4. One minute before they are finished, add the four herbs. After 1 minute, remove from heat.\n5. In a large bowl, mash mushroom stems and chickpeas.\n6. Add all other ingredients. Mix well.\n7. Lightly spray a baking sheet and the mushroom caps.\n8. Stuff the mushrooms with the mixture and place on baking sheet.\n9. Bake for 15 to 18 minutes or until the stuffing is golden brown.\n10. Remove from oven, sprinkle with an herb of your choice, and enjoy.\nCheck the label: Bread crumbs vary by brand: some contain milk or egg.\n\nSource: recipe by USDA Center for Nutrition Policy and Promotion (submitted by Dave, MyPlate nutritionist). Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/daves-herb-stuffed-mushrooms), public domain. Edition: MyPlate.food, https://myplate.food/recipes/daves-herb-stuffed-mushrooms."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Garden Cannellini Bean Salad | سلطة الفاصوليا البيضاء بالخضار",
"text": "Vegan recipe: Garden Cannellini Bean Salad (Arabic name: سلطة الفاصوليا البيضاء بالخضار). Type: main salad. Makes 4 servings; serving size: 1/4 of recipe.\nNutrition per serving (USDA panel): 409 kcal, 20.2 g protein, 13.8 g fiber.\nAbout: Chopped tomatoes, bell peppers, and cucumbers combine with cannellini (white) beans, almonds, and a simple vinaigrette for a delicious and satisfying salad.\n\nIngredients for Garden Cannellini Bean Salad:\n- For the dressing:\n- 1 tablespoon olive oil\n- 2 teaspoons white wine vinegar\n- 1/2 cup apple juice\n- 1 tablespoon tomato basil garlic seasoning blend, no-salt\n- For the bean salad:\n- 1/2 cup almond slivers\n- 2 tomatoes, coarsely chopped\n- 1/2 yellow bell pepper, chopped\n- 1/2 cucumber, peeled, chopped\n- 3 green onions, sliced\n- 2 cans (15.5 oz each) cannellini (white) beans, low-sodium, drained, and rinsed\n- Large lettuce leaves (Boston, Bibb, or romaine)\n\nDirections for Garden Cannellini Bean Salad:\n1. Whisk together dressing ingredients in a small bowl.\n2. In a small sauté pan, toast almond slivers until golden.\n3. Remove from pan and let cool.\n4. In a medium bowl, toss dressing with all ingredients except lettuce.\n5. Refrigerate until ready to serve.\n6. To serve, place lettuce leaves on individual plates; top with salad.\nThe Yara website also has a version of this recipe adapted for Saudi supermarkets.\n\nSource: recipe by Produce for Better Health Foundation. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/garden-cannellini-bean-salad), public domain. Edition: MyPlate.food, https://myplate.food/recipes/garden-cannellini-bean-salad."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Sautéed Cabbage and Onion | ملفوف وبصل مقلّب",
"text": "Vegan recipe: Sautéed Cabbage and Onion (Arabic name: ملفوف وبصل مقلّب). Type: side dish. Makes 4 servings; serving size: 1/4 of recipe.\nNutrition per serving (USDA panel): 53 kcal, 1.8 g protein, 3.4 g fiber.\nAbout: Cabbage, onion, and caraway seeds make this simple and inexpensive side dish a flavorful way to eat more veggies.\n\nIngredients for Sautéed Cabbage and Onion:\n- 1 teaspoon vegetable oil\n- 1 onion (sliced)\n- 4 1/2 cups cabbage (sliced)\n- 1/4 teaspoon salt\n- 1/4 teaspoon black pepper\n- 1 teaspoon caraway seeds\n\nDirections for Sautéed Cabbage and Onion:\n1. Wash hands with soap and water.\n2. Heat oil in a large sauté pan.\n3. Sauté onion over medium heat, until light brown, about 5 to 6 minutes.\n4. Add sliced cabbage, salt, black pepper, and caraway seeds.\n5. Stir and cook for 30 minutes.\n6. Serve immediately.\n\nSource: recipe by \"Cabbage Comfort\", National Cancer Institute (NCI), 5 A Day for Better Health Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/sauteed-cabbage-and-onion), public domain. Edition: MyPlate.food, https://myplate.food/recipes/sauteed-cabbage-and-onion."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Simmered Beans | فاصوليا مطهوة على نار هادئة",
"text": "Vegan recipe: Simmered Beans (Arabic name: فاصوليا مطهوة على نار هادئة). Type: side dish. Makes 12 servings; serving size: 1/2 cup prepared beans, 1/12 of recipe.\nNutrition per serving (USDA panel): 113 kcal, 7 g protein, 7 g fiber.\nAbout: Savory simmered beans are simple and satisfying. Enjoy as a side to your favorite entrée.\n\nIngredients for Simmered Beans:\n- 2 cups dried beans, rinsed (pinto, black, or pink)\n- 8 cups water\n- 1 onion, chopped\n- 1 bay leaf\n- 1/4 teaspoon salt\n\nDirections for Simmered Beans:\n1. Wash hands with soap and water.\n2. Place beans, water, onion, and bay leaf in a large pot.\n3. Cover and bring to a boil over high heat.\n4. Reduce heat to low.\n5. Simmer for 1 to 1 1/2 hours or until beans are tender.\n6. Remove bay leaf and stir in salt.\n7. Cook 15 minutes longer.\n8. Top each serving of simmered beans with 1/2 cup fresh salsa, or store beans in refrigerator for up to 3 days in a covered plastic or glass container.\n\nSource: recipe by Healthy Latino Recipes Made with Love, California Department of Health Services, California Latino 5-A-Day Campaign. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/simmered-beans), public domain. Edition: MyPlate.food, https://myplate.food/recipes/simmered-beans."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Spring Vegetable Sauté | خضار الربيع المقلّبة",
"text": "Vegan recipe: Spring Vegetable Sauté (Arabic name: خضار الربيع المقلّبة). Type: side dish. Makes 4 servings; serving size: 1/4 of recipe.\nNutrition per serving (USDA panel): 138 kcal, 4.1 g protein, 4.4 g fiber.\nAbout: Bursting with delicious spring flavors, this sauté is perfect with a side of tofu.\n\nIngredients for Spring Vegetable Sauté:\n- 1 teaspoon olive oil (or cooking oil of choice)\n- 1/2 cup medium sweet onion, sliced\n- 1 garlic clove, finely chopped\n- 3 small new potatoes, quartered\n- 3/4 cup carrots, sliced\n- 3/4 cup asparagus pieces\n- 3/4 cup sugar snap peas, or green beans\n- 1/2 cup radishes, quartered\n- 1/4 teaspoon salt\n- 1/4 teaspoon black pepper\n- 1/2 teaspoon dried dill\n\nDirections for Spring Vegetable Sauté:\n1. Wash hands with soap and water.\n2. Heat the oil in a large skillet over medium heat.\n3. Cook the onion for 2 minutes, then add the garlic and cook another minute. Stir in the potatoes and carrots.\n4. Cover, turn the heat to low, and cook until almost tender, about 4 minutes.\n5. If the vegetables start to brown, add a tablespoon or two of water.\n6. Now add the asparagus, peas, radishes, salt, pepper, and dill.\n7. Cook, stirring often, until just tender, about 4 minutes more.\n8. Serve immediately.\n\nSource: recipe by US Department of Health and Human Services, National Cancer Institute. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/spring-vegetable-saute), public domain. Edition: MyPlate.food, https://myplate.food/recipes/spring-vegetable-saute."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Lentil Vegetable Soup | شوربة العدس بالخضار",
"text": "Vegan recipe: Lentil Vegetable Soup (Arabic name: شوربة العدس بالخضار). Type: soup. Makes 6 servings; serving size: 1/6 of recipe (316g).\nNutrition per serving (USDA panel): 163 kcal, 9 g protein, 8.2 g fiber.\nAbout: Enjoy this hearty vegetable and lentil soup, packed with lentils, celery, onion, and tomato sauce, on a cold winter's evening.\n\nIngredients for Lentil Vegetable Soup:\n- 1 cup lentils (dry)\n- 5 cups water\n- 2 tablespoons vegetable oil\n- 1 tablespoon onion (finely chopped)\n- 1 cup canned tomato sauce, low-sodium\n- 1/2 teaspoon garlic powder (or 1 garlic clove)\n- 1 teaspoon salt\n- 1/4 teaspoon black pepper\n- 1 bay leaf\n- 1 celery stalk (chopped)\n- 2 tablespoons vinegar\n\nDirections for Lentil Vegetable Soup:\n1. Wash hands with soap and water.\n2. Sort lentils.\n3. Place lentils in deep pot with water.\n4. Bring to a boil and add all ingredients except vinegar.\n5. Reduce heat and cover.\n6. Cook slowly for 1 hour, adding more water if necessary.\n7. Add vinegar.\n8. Remove garlic and bay leaf before serving.\nThe Yara website also has a version of this recipe adapted for Saudi supermarkets.\n\nSource: recipe by Recipe Collection, University of Nebraska at Lincoln, Nebraska Nutrition Education Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/lentil-vegetable-soup), public domain. Edition: MyPlate.food, https://myplate.food/recipes/lentil-vegetable-soup."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Crusty Rice with Tofu and Vegetables | أرز مقرمش بالتوفو والخضار",
"text": "Vegan recipe: Crusty Rice with Tofu and Vegetables (Arabic name: أرز مقرمش بالتوفو والخضار). Type: main dish. Makes 4 servings; serving size: 1 1/2 cups.\nNutrition per serving (USDA panel): 425 kcal, 19.3 g protein, 7.4 g fiber.\nAbout: This blend of tofu and cooked rice combines corn, peas, carrots, and seasonings pressed into a skillet and cooked into crispy goodness.\n\nIngredients for Crusty Rice with Tofu and Vegetables:\n- For the rice:\n- 2 cups water\n- 1 cup brown rice\n- For the tofu and vegetables:\n- 3 cups prepared rice (from the ingredients above)\n- 1 pound tofu\n- 1 cup frozen corn (unthawed)\n- 1 cup frozen peas (unthawed)\n- 6 scallions (sliced, including white and green parts)\n- 1 carrot (shredded)\n- 1/4 cup fresh basil leaves\n- 1/4 teaspoon salt\n- 2 tablespoons vegetable oil\n\nDirections for Crusty Rice with Tofu and Vegetables:\n1. To make the rice, cook rice according to the directions on the package.\n2. Set aside to cool and dry out.\n3. Put the tofu, corn, scallions, carrot, basil, and salt in the bowl and mix well.\n4. When the rice has fully cooled, add it to the bowl with the tofu and mix well.\n5. Put the skillet over medium high heat and when it is hot, add the oil.\n6. Add the rice and tofu mixture; reduce heat to low and press down the rice mixture with a spatula.\n7. Cover and cook 10 minutes.\n8. Press down again to help form a crust.\n9. Flip portions of the rice so that you get chunks of crispy rice.\n10. Cook until crispy, up to 20 minutes.\n\nYara note: The published steps don't mention the peas; add them with the corn.\n\nSource: recipe by USDA Center for Nutrition Policy and Promotion. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/crusty-rice-tofu-and-vegetables), public domain. Edition: MyPlate.food, https://myplate.food/recipes/crusty-rice-tofu-and-vegetables."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Chickpeas and Spinach Sauté | حمص مع السبانخ",
"text": "Vegan recipe: Chickpeas and Spinach Sauté (Arabic name: حمص مع السبانخ). Type: main dish. Makes 4 servings; serving size: 1 serving.\nNutrition per serving (USDA panel): 193 kcal, 9.7 g protein, 10.7 g fiber.\nAbout: Sautéed veggies simmered with a can of tomatoes, chickpeas and wilted spinach make up this colorful dish. This recipe calls for chickpeas and spinach, but any combination of beans and greens will work.\n\nIngredients for Chickpeas and Spinach Sauté:\n- 1 tablespoon vegetable oil\n- 1 yellow onion (peeled and chopped)\n- 1 clove garlic (peeled and minced)\n- 1 celery stalk (chopped)\n- 1 carrot (chopped)\n- 1 can (14.5 oz) diced tomatoes, no salt added (including liquid)\n- 1 can (16 oz) low-sodium chickpeas (drained and rinsed with cold water)\n- 1/4 cup water\n- 1 package (10 oz) frozen spinach (kale can be used instead of spinach)\n- 1 teaspoon fresh lemon juice (or red vinegar)\n- 1/4 teaspoon crushed red pepper flakes\n\nDirections for Chickpeas and Spinach Sauté:\n1. Put a skillet on the stove on medium high heat.\n2. When the skillet is hot, add oil.\n3. Add onion, garlic, celery and carrot and cook about 15 minutes until the mixture is soft and the onions are lightly browned.\n4. Raise the heat to high and add the tomatoes, beans (white beans can be used instead of chickpeas) and water and cook for 5 minutes.\n5. Lower the heat to low and top the mixture with the spinach (don't worry about stirring).\n6. Cover and cook until the spinach has thawed and heated throughout, about 10 minutes.\n7. Stir well.\n8. Add the lemon juice and red pepper flakes and stir thoroughly.\n9. Serve with cooked quinoa or brown rice.\nThe Yara website also has a version of this recipe adapted for Saudi supermarkets.\n\nSource: recipe by USDA Center for Nutrition Policy and Promotion. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/chickpeas-and-spinach-saute), public domain. Edition: MyPlate.food, https://myplate.food/recipes/chickpeas-and-spinach-saute."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Red Beans and Rice | فاصوليا حمراء مع الأرز",
"text": "Vegan recipe: Red Beans and Rice (Arabic name: فاصوليا حمراء مع الأرز). Type: main dish. Makes 4 servings; serving size: 1 serving.\nNutrition per serving (USDA panel): 479 kcal, 17.5 g protein, 17.9 g fiber.\nAbout: Red kidney beans and tomatoes flavored with garlic, onions, peppers, and seasonings and simmered until tender. Serve the bean mixture over rice and top with avocado and cilantro for a traditional meal or side dish.\n\nIngredients for Red Beans and Rice:\n- 1 cup uncooked brown rice\n- 2 teaspoons vegetable oil\n- 2 cloves garlic (peeled and minced)\n- 1 small yellow onion (chopped)\n- 1 bell pepper (cored, seeded, and chopped)\n- 1 1/2 ounces water\n- 1 fresh tomato (coarsely chopped)\n- 1/4 teaspoon salt\n- 1/8 teaspoon ground cumin\n- 2 cans (15.5 ounce) low-sodium red kidney beans (drained and rinsed)\n- 1 1/2 cups water\n- 1 avocado (peeled, pitted and chopped)\n- 2 tablespoons fresh cilantro (chopped, optional)\n\nDirections for Red Beans and Rice:\n1. To prepare the rice: Put the rice and water in the pot and bring to a boil over high heat.\n2. Turn the heat down to low and cook, covered, until the rice is tender, about 45 minutes.\n3. To prepare the beans: Place the large skillet on the stove over medium-high heat.\n4. When it is hot, add the oil.\n5. Add the garlic, onion, bell pepper, and 2 tablespoons water.\n6. Cook until the mixture is golden, about 10 minutes.\n7. Add the tomato, salt, cumin, beans, and water and cook until the beans are very soft, about 20 to 30 minutes.\n8. Divide the cooked rice among 4 bowls or plates, and top with equal amounts of the bean mixture.\n9. Top with avocado and sprinkle with cilantro, if using.\n10. Serve right away, or cover and refrigerate up to 3 days.\n\nYara note: The published recipe doesn't give the amount of water for the rice; brown rice usually takes about 2 cups of water per cup of rice.\nThe Yara website also has a version of this recipe adapted for Saudi supermarkets.\n\nSource: recipe by USDA Center for Nutrition Policy and Promotion. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/red-beans-and-rice-0), public domain. Edition: MyPlate.food, https://myplate.food/recipes/red-beans-and-rice-0."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: White Bean Bruschetta | بروسكيتا الفاصوليا البيضاء",
"text": "Vegan recipe: White Bean Bruschetta (Arabic name: بروسكيتا الفاصوليا البيضاء). Type: side or appetizer. Makes 4 servings; serving size: 3 slices.\nNutrition per serving (USDA panel): 341 kcal, 10.2 g protein, 5.9 g fiber.\nAbout: Crispy bread topped with white beans, tomatoes, and spices. Served as a side dish or an appetizer, it is sure to be a crowd pleaser.\n\nIngredients for White Bean Bruschetta:\n- 1 whole-wheat French baguette, cut into 12 thin slices along the bias\n- 1/4 cup olive oil, divided\n- 1 cup white onion, chopped\n- 4 cloves garlic, minced\n- 1 teaspoon dried basil\n- 1 teaspoon dried oregano\n- 1 cup canned navy beans, rinsed and drained\n- 2 tomatoes, cored and cubed\n- 2 tablespoons balsamic vinegar\n\nDirections for White Bean Bruschetta:\n1. Slice the baguette on the diagonal into thin slices (about 12 slices for a baguette).\n2. In a large sauté pan, heat 2 tablespoons of the olive oil over medium heat.\n3. Place the bread slices in the pan and cook on medium high heat until sizzling and golden.\n4. Before flipping the bread, add an additional tablespoon of olive oil to the pan and cook the second side until golden.\n5. For the topping, cook the onions and the remaining tablespoon of olive oil over medium heat until the onions are soft, about 7 minutes.\n6. Add the garlic, basil, and oregano and cook another minute or two, until fragrant.\n7. Add beans and continue cooking for another five minutes on low heat.\n8. Add the tomatoes and turn off the heat, allowing tomatoes to warm without cooking.\n9. Drizzle the balsamic vinegar into the pan and gently stir.\n10. Scoop heaping spoonfuls of the tomato-bean mixture onto the grilled bread and enjoy.\nCheck the label: Baguettes vary by brand: some contain milk or butter.\n\nSource: recipe by MyPlate National Strategic Partners, The Grain Chain. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/white-bean-bruschetta), public domain. Edition: MyPlate.food, https://myplate.food/recipes/white-bean-bruschetta."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Rainbow Bell Pepper Boats with Garbanzo Beans and Kale | فلفل ملوّن محشي بالحمص والكيل",
"text": "Vegan recipe: Rainbow Bell Pepper Boats with Garbanzo Beans and Kale (Arabic name: فلفل ملوّن محشي بالحمص والكيل). Type: main dish. Makes 4 servings; serving size: 1 serving.\nNutrition per serving (USDA panel): 347 kcal, 11.6 g protein, 9.2 g fiber.\nAbout: Red, orange, and yellow bell peppers stuffed with garbanzo beans (chickpeas), kale, walnuts, and brown rice make a delicious Mediterranean-influenced vegetarian dish.\n\nIngredients for Rainbow Bell Pepper Boats with Garbanzo Beans and Kale:\n- 2 cups instant brown rice, cooked\n- 4 medium bell peppers (red, yellow, and orange)\n- 2 cups kale, chopped\n- 1 can (15 oz) garbanzo beans (chickpeas), low-sodium\n- 1/2 cup walnuts, chopped\n- 1/4 teaspoon salt\n- 1/8 teaspoon pepper\n\nDirections for Rainbow Bell Pepper Boats with Garbanzo Beans and Kale:\n1. Preheat oven to 375 °F (190 °C). Cook rice according to package directions.\n2. Slice bell peppers in half vertically and remove seeds.\n3. Reserve about half of garbanzo beans; mash remaining portion with a fork.\n4. Mix rice with kale, garbanzo beans (mashed and whole), nuts, salt, and pepper.\n5. Fill peppers with mix; place in baking dish and cover.\n6. Bake about 30 minutes.\n7. Remove lid and bake 5 more minutes.\n\nSource: recipe by Produce for Better Health Foundation. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/rainbow-bell-pepper-boats-garbanzo-beans-and-kale), public domain. Edition: MyPlate.food, https://myplate.food/recipes/rainbow-bell-pepper-boats-garbanzo-beans-and-kale."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Butternut Squash with Black Beans | قرع عسلي مع الفاصوليا السوداء",
"text": "Vegan recipe: Butternut Squash with Black Beans (Arabic name: قرع عسلي مع الفاصوليا السوداء). Type: side dish. Makes 6 servings; serving size: 1/6 of recipe.\nNutrition per serving (USDA panel): 173 kcal, 9.6 g protein, 12.1 g fiber.\nAbout: Butternut squash and black beans make a hearty side dish that is delicious and full of fiber and protein.\n\nIngredients for Butternut Squash with Black Beans:\n- 2 3/4 cups butternut squash, cubed (1 small squash, about 1 pound)\n- 1 small onion, chopped\n- 1 teaspoon vegetable oil (or cooking oil of choice)\n- 1/4 teaspoon garlic powder\n- 1/4 cup red wine vinegar\n- 1/4 cup water\n- 2 cans (15.5 ounces each) low-sodium black beans, rinsed and drained\n- 1/2 teaspoon oregano\n\nDirections for Butternut Squash with Black Beans:\n1. Wash hands with soap and water.\n2. Heat the squash in the microwave on high heat for 1 to 2 minutes. This will soften the skin.\n3. Carefully peel the squash with a vegetable peeler or small knife.\n4. Cut the squash into 1/2 inch cubes.\n5. Peel and chop the onion.\n6. In a large pan, heat the oil.\n7. Add the onion, garlic powder, and squash.\n8. Cook for 5 minutes on medium heat.\n9. Add vinegar and water.\n10. Cook on low heat until the squash is tender, about 10 minutes.\n11. Add the beans and oregano.\n12. Cook until the beans are heated through.\n\nSource: recipe by Pennsylvania Nutrition Education Network. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/butternut-squash-black-beans), public domain. Edition: MyPlate.food, https://myplate.food/recipes/butternut-squash-black-beans."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Baked Tofu | توفو مخبوز",
"text": "Vegan recipe: Baked Tofu (Arabic name: توفو مخبوز). Type: protein for any meal. Makes 4 servings; serving size: 2 slices, 1/4 of recipe (124g).\nNutrition per serving (USDA panel): 99 kcal, 10.7 g protein, 1.1 g fiber.\nAbout: Ginger, soy sauce, and garlic fill this tofu with flavor. This dish is protein-packed and friendly to a vegetable-based diet.\n\nIngredients for Baked Tofu:\n- 2 tablespoons soy sauce, reduced-sodium\n- 1 clove garlic, minced (or 1/4 teaspoon garlic powder)\n- 1 teaspoon fresh ginger, minced\n- 1 teaspoon vegetable oil (or cooking oil of choice)\n- 1 package (14 ounces) firm or extra firm tofu, water packed\n\nDirections for Baked Tofu:\n1. Wash hands with soap and water.\n2. Preheat oven to 350 °F (175 °C). Line a rimmed baking sheet with foil.\n3. Drain water from tofu.\n4. Wrap tofu in paper towels. Let set for about 5 minutes.\n5. While tofu is draining, combine soy sauce, garlic, ginger, and vegetable oil in a small bowl.\n6. Slice tofu into 1/2 inch thick slices.\n7. Place tofu slices on foil lined baking sheet.\n8. Pour soy sauce mixture over tofu.\n9. Using a spatula, gently turn slices over to coat both sides with sauce.\n10. Bake tofu for 15 minutes.\n11. Turn slices over and bake for another 15 minutes. Tofu should be light golden brown and firm.\n12. Serve hot in place of meat, or cut into slices or cubes and add to a stir-fry, fried rice, soup, or salad.\n\nSource: recipe by Montana State University Extension Service. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/baked-tofu), public domain. Edition: MyPlate.food, https://myplate.food/recipes/baked-tofu."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Baked Tortilla Chips | رقائق تورتيلا مخبوزة",
"text": "Vegan recipe: Baked Tortilla Chips (Arabic name: رقائق تورتيلا مخبوزة). Type: snack. Makes 6 servings; serving size: 4 chips, 1/6 of recipe.\nNutrition per serving (USDA panel): 111 kcal, 3.5 g protein, 3.5 g fiber.\nAbout: Use this recipe to make your own whole wheat flour or corn flour tortilla chips.\n\nIngredients for Baked Tortilla Chips:\n- 3 whole wheat flour tortillas, 10 inches across\n- 3 sprays of cooking oil spray\n- salt (dash, optional)\n\nDirections for Baked Tortilla Chips:\n1. Wash hands with soap and water.\n2. Preheat oven or toaster oven to 400 °F (200 °C). Lightly grease a baking sheet with the cooking spray.\n3. Cut tortillas into 8 sections (as if you were cutting a pizza) and place on baking sheet.\n4. Spray tops of tortilla sections with cooking spray and lightly salt, if desired.\n5. Bake for 10 minutes, until crisp and light brown, watching closely so the chips don't burn.\n\nYara note: Corn tortillas may also be used for fewer calories and less fat.\nCheck the label: Tortillas vary by brand: some contain milk, whey or lard.\n\nSource: recipe by Eating Smart, Being Active, Colorado State University and University of California at Davis. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/baked-tortilla-chips), public domain. Edition: MyPlate.food, https://myplate.food/recipes/baked-tortilla-chips."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Hearty Mexican Soup | شوربة مكسيكية بالفاصوليا السوداء",
"text": "Vegan recipe: Hearty Mexican Soup (Arabic name: شوربة مكسيكية بالفاصوليا السوداء). Type: soup. Makes 5 servings; serving size: 1/5 of the recipe.\nNutrition per serving (USDA panel): 249 kcal, 13.2 g protein, 15.5 g fiber.\nAbout: Easy to make and delicious to eat, this soup can be made in under an hour. Squeeze the other half of the lime over the soup before serving for extra flavor.\n\nIngredients for Hearty Mexican Soup:\n- 1 onion (small, chopped)\n- 4 cloves garlic (minced)\n- 1 can (14.5 ounces) tomatoes, diced, low-sodium\n- 2 cans (15 ounces each) black beans, low-sodium, drained and rinsed\n- 2 potatoes (large, peeled and diced)\n- 4 cups water\n- 1/2 cup cilantro (fresh, chopped)\n- 1/2 lime (squeezed)\n- 1/8 teaspoon cumin powder (a pinch)\n\nDirections for Hearty Mexican Soup:\n1. Wash hands with soap and water.\n2. In a large pot cook onion, garlic and tomatoes on medium-high heat for 3 minutes. Stir often.\n3. Add beans, potatoes and water.\n4. Bring to a boil, then reduce to low-medium heat.\n5. Cover and continue to cook slowly for 20 minutes.\n6. Add cilantro, cumin and lime.\n7. Stir and continue to simmer for 10 minutes.\n8. Serve warm; sprinkle cilantro on top.\n\nSource: recipe by Simple Healthy Recipes, Oklahoma Nutrition Information and Education (ONIE) Project. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/hearty-mexican-soup), public domain. Edition: MyPlate.food, https://myplate.food/recipes/hearty-mexican-soup."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Caribbean Casserole | طاجن كاريبي بالأرز والفاصوليا",
"text": "Vegan recipe: Caribbean Casserole (Arabic name: طاجن كاريبي بالأرز والفاصوليا). Type: main dish. Makes 10 servings; serving size: 1 cup.\nNutrition per serving (USDA panel): 182 kcal, 5.8 g protein, 5.7 g fiber.\nAbout: This quick one-skillet casserole of beans, bell peppers, tomatoes, and oregano uses instant brown rice to reduce cooking time.\n\nIngredients for Caribbean Casserole:\n- 1 medium onion, chopped\n- 1/2 medium green pepper, diced\n- 1 tablespoon canola oil (or cooking oil of choice)\n- 1 can (14.5 ounces) stewed tomatoes, low-sodium\n- 1 can (15.5 ounces) black beans, low sodium (or beans of your choice)\n- 1 teaspoon oregano leaves\n- 1/2 teaspoon garlic powder\n- 1 1/2 cups instant brown rice, uncooked\n\nDirections for Caribbean Casserole:\n1. Wash hands with soap and water.\n2. Sauté onion and green pepper in canola oil, in a large pan, until tender. Do not brown.\n3. Add tomatoes, beans (include liquid from both), oregano, and garlic powder.\n4. Bring to a boil.\n5. Stir in rice and cover.\n6. Reduce heat to simmer for 5 minutes.\n7. Remove from heat and let stand for 5 minutes.\n\nSource: recipe by Heart Healthy Home Cooking: African American Style, US Department of Health and Human Services, National Heart, Lung, and Blood Institute. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://www.myplate.gov/recipes/caribbean-casserole), public domain. Edition: MyPlate.food, https://myplate.food/recipes/caribbean-casserole."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Lentil Stew | يخنة العدس",
"text": "Vegan recipe: Lentil Stew (Arabic name: يخنة العدس). Type: main dish. Makes 10 servings; serving size: 1 cup.\nNutrition per serving (USDA panel): 113 kcal, 6 g protein, 7 g fiber.\nAbout: Lentils, carrots, and tomatoes are a savory and satisfying combination in this delicious and easy to prepare stew. Enjoy with a side of your favorite citrus fruit.\n\nIngredients for Lentil Stew:\n- 2 teaspoons olive oil (or canola oil)\n- 1 onion (large, chopped)\n- 1 teaspoon garlic powder\n- 1 1/2 10-ounce packages of frozen sliced carrots\n- 1 cup dry lentils (rinsed and drained)\n- 3 cans diced tomatoes, low-sodium (14.5 ounces each)\n- 3 cups water\n- 1 teaspoon chili powder\n\nDirections for Lentil Stew:\n1. Wash hands with soap and water.\n2. Heat the oil in a large pot over medium heat.\n3. Add chopped onion.\n4. Cook for 3 minutes, or until tender.\n5. Stir in garlic powder, carrots, lentils, tomatoes, water, and chili powder.\n6. Simmer, uncovered, for about 20 minutes or until lentils are tender.\n\nYara note: Reviewers on the USDA page found 20 minutes too short; simmer until the lentils are tender and add water if needed.\n\nSource: recipe by 2009 Recipe Calendar, University of Maryland Extension, Food Supplement Nutrition Education Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/lentil-stew), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Lentil Stew. Recipe source: 2009 Recipe Calendar, University of Maryland Extension, Food Supplement Nutrition Education Program. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Overnight Oatmeal | شوفان منقوع طوال الليل",
"text": "Vegan recipe: Overnight Oatmeal (Arabic name: شوفان منقوع طوال الليل). Type: breakfast. Makes 2 servings; serving size: 1/2 of recipe.\nNutrition per serving (USDA panel): 333 kcal, 8 g protein, 7 g fiber.\nAbout: Overnight soaking cuts down on prep time in the morning, so you can enjoy a healthy and hearty, cooked breakfast, even after hitting the snooze button.\n\nIngredients for Overnight Oatmeal:\n- 1 cup dry oats\n- 2 1/2 cups water\n- 1/2 cup dried fruit (raisins, cranberries, or apricots)\n- 1/4 cup walnuts, lightly chopped (or pecans)\n\nDirections for Overnight Oatmeal:\n1. Wash hands with soap and water.\n2. Put all ingredients in a cooking pot and cover. Let sit overnight in refrigerator.\n3. In the morning, put on a stove burner and cook on medium heat until simmering, then turn on low and heat for 10 to 15 minutes more or less depending on type of oats -- quick (5 minutes), regular, or steel cut.\n4. Serve warm with a little milk (or milk alternative), a drizzle of maple syrup, and a side of fresh fruit, if desired.\n\nYara note: To keep it vegan, serve with a plant milk, not dairy milk. The nutrition figures use raisins and walnuts.\n\nSource: recipe by Lake Family Resource Center, Be-Fresh Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/overnight-oatmeal), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Overnight Oatmeal. Recipe source: Lake Family Resource Center, Be-Fresh Program. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Tofu with Broccoli | توفو مع البروكلي",
"text": "Vegan recipe: Tofu with Broccoli (Arabic name: توفو مع البروكلي). Type: main dish. Makes 4 servings; serving size: 4 ounce serving.\nNutrition per serving (USDA panel): 206 kcal, 16 g protein, 5 g fiber.\nAbout: Tofu cooked until golden brown, and broccoli sautéed in a soy and scallion sauce make up this one-skillet meal. Serve with a side of brown rice for a quick dish.\n\nIngredients for Tofu with Broccoli:\n- 1 pound firm tofu\n- 4 teaspoons vegetable oil, divided\n- 2 cloves garlic, minced\n- 2 scallions, chopped\n- 1 head broccoli, chopped\n- 1/4 cup water\n- 1 tablespoon reduced sodium soy sauce\n- 1/2 teaspoon crushed red pepper flakes\n- 1 tablespoon chopped fresh cilantro (or basil leaves)\n\nDirections for Tofu with Broccoli:\n1. Put the tofu on a cutting board and cut it in half and then cut each half into 4 equal pieces.\n2. Put 2 layers of paper towel on a cutting board and put the tofu on top. Let drain at least 20 minutes (and up to 2 hours).\n3. Place a skillet over medium heat and when hot, add 2 teaspoons oil. Add the tofu, one piece at a time, and cook until golden, about 3 minutes per side. Remove the tofu to a plate and set aside.\n4. Reheat the skillet and when hot, add remaining 2 teaspoons oil. Add garlic and scallions and cook until just golden, about 2 minutes. Add the broccoli and water and raise the heat to high. Cook until the broccoli is tender, about 4 minutes.\n5. Return the tofu to the pan and add the remaining ingredients. Stir well.\n6. Serve with a side of brown rice.\n\nSource: recipe by USDA Center for Nutrition Policy and Promotion. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/tofu-broccoli), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Tofu with Broccoli. Recipe source: USDA Center for Nutrition Policy and Promotion. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Veggie Bean Wrap | لفافة الخضار والفاصوليا",
"text": "Vegan recipe: Veggie Bean Wrap (Arabic name: لفافة الخضار والفاصوليا). Type: main dish. Makes 4 servings; serving size: 1 prepared wrap, 1/4 of recipe (506g).\nNutrition per serving (USDA panel): 458 kcal, 15 g protein, 15 g fiber.\nAbout: These delicious wraps are packed full of flavor and fiber. Mango, cilantro and avocado add a fresh topping to these wraps.\n\nIngredients for Veggie Bean Wrap:\n- 2 green or red bell peppers (seeded and chopped)\n- 1 onion (peeled and sliced)\n- 1 can black beans, low-sodium (15 ounce, drained and rinsed)\n- 2 mangos (chopped)\n- 1 lime (juiced)\n- 1/2 cup fresh cilantro (chopped)\n- 1 avocado (peeled and diced)\n- 4 flour tortillas (10 inch)\n\nDirections for Veggie Bean Wrap:\n1. Wash hands with soap and water.\n2. In a nonstick pan, sauté bell peppers and onion for 5 minutes over medium heat. Add beans, stir well. Reduce heat to low and simmer about 5 minutes.\n3. In a small bowl, combine mangoes, lime juice, cilantro, and avocado. Set aside 1/2 of this mango mixture for topping.\n4. Fill warmed tortillas with 1/4 bean mixture and 1/4 mango mixture.\n5. Fold ends of the tortillas over. Roll up to make wraps. Top veggie bean wraps with remaining mango mixture.\nCheck the label: Flour tortillas vary by brand: some contain milk, whey or lard.\n\nSource: recipe by Healthy Latino Recipes Made with Love, California Department of Health Services, California Latino 5-A-Day Campaign. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/veggie-bean-wrap), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Veggie Bean Wrap. Recipe source: Healthy Latino Recipes Made with Love, California Department of Health Services, California Latino 5-A-Day Campaign. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Pumpkin Chocolate Muffins | مافن اليقطين بالشوكولاتة",
"text": "Vegan recipe: Pumpkin Chocolate Muffins (Arabic name: مافن اليقطين بالشوكولاتة). Type: snack or dessert. Makes 24 muffins; serving size: 1 muffin, 1/24 of recipe.\nNutrition per serving (USDA panel): 89 kcal, 2 g protein, 2 g fiber.\nAbout: This dense, moist chocolate muffin contains no fats or oils. The secret ingredient is canned (or puréed) pumpkin that binds the ingredients together for a tasty, satisfying treat.\n\nIngredients for Pumpkin Chocolate Muffins:\n- 2 cups all-purpose flour\n- 3/4 cup sugar\n- 1 teaspoon baking powder\n- 1/2 teaspoon baking soda\n- 1/2 cup cocoa powder\n- 1 can pumpkin\n- 1 cup water\n- 1/2 cup chocolate chips\n\nDirections for Pumpkin Chocolate Muffins:\n1. Wash hands with soap and water.\n2. Whisk all the dry ingredients together. Add pumpkin and water.\n3. Fold the wet ingredients into the dry ingredients until just combined. Fold in chocolate chips.\n4. Place batter into 24 prepared muffin tins and bake at 350 °F (175 °C) for 10 to 12 minutes.\nCheck the label: Chocolate chips vary by brand: many contain milk. Buy dark chocolate chips labeled dairy-free or vegan.\n\nSource: recipe by With Veggies, More Matters!, Michigan State University Extension - Midland County. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/pumpkin-chocolate-muffins), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Pumpkin Chocolate Muffins. Recipe source: With Veggies, More Matters!, Michigan State University Extension - Midland County. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Hummus | حمص بالطحينة",
"text": "Vegan recipe: Hummus (Arabic name: حمص بالطحينة). Type: snack or dip. Makes 8 servings; serving size: 1/6 of recipe.\nNutrition per serving (USDA panel): 117 kcal, 4 g protein, 4 g fiber.\nAbout: This classic garbanzo bean dip is easy to make and a versatile dish. Serve hummus with fresh raw vegetables, on a piece of whole wheat pita bread or tortilla, on crackers, or as a sandwich filling.\n\nIngredients for Hummus:\n- 2 cups garbanzo beans, cooked (also known as chickpeas)\n- 2 cloves garlic (minced)\n- 1/4 cup lemon juice\n- 1 tablespoon sesame tahini [sesame paste] (or substitute peanut butter for a sweet taste)\n- 2 tablespoons olive oil\n\nDirections for Hummus:\n1. Wash hands with soap and water.\n2. Mash the garbanzo beans until smooth (if you have a blender, put the beans and lemon juice into it and blend).\n3. Add the garlic, lemon juice, tahini and oil. Mix well.\n\nYara note: The USDA page says it makes 8 servings but gives nutrition for 1/6 of the recipe; the figures here are per 1/6.\n\nSource: recipe by Simple Healthy Recipes, Oklahoma Nutrition Information and Education (ONIE) Project. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/hummus), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Hummus. Recipe source: Simple Healthy Recipes, Oklahoma Nutrition Information and Education (ONIE) Project. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Quinoa and Black Bean Salad | سلطة الكينوا والفاصوليا السوداء",
"text": "Vegan recipe: Quinoa and Black Bean Salad (Arabic name: سلطة الكينوا والفاصوليا السوداء). Type: main salad. Makes 6 servings; serving size: 1 cup (254g).\nNutrition per serving (USDA panel): 167 kcal, 7 g protein, 8 g fiber.\nAbout: Quinoa (pronounced \"KEEN-wah\") is a whole grain with origins in South America. It is combined in this recipe with black beans, savory vegetables, and spices for a cold salad that is light and refreshing. This salad is high in protein and can be served as a main or side dish.\n\nIngredients for Quinoa and Black Bean Salad:\n- 1/2 cup quinoa (dry)\n- 1 1/2 cups water\n- 1 1/2 tablespoons olive oil\n- 3 teaspoons lime juice\n- 1/4 teaspoon cumin\n- 1/4 teaspoon coriander (ground, dried cilantro seeds)\n- 2 tablespoons cilantro (chopped)\n- 2 scallions (medium, minced)\n- 1 can black beans, low-sodium (15.5 ounce can, rinsed and drained)\n- 2 cups tomato (chopped)\n- 1 red bell pepper (medium, chopped)\n- 1 green bell pepper (medium, chopped)\n- 2 green chiles (minced, to taste)\n- black pepper (to taste)\n\nDirections for Quinoa and Black Bean Salad:\n1. Wash hands with soap and water.\n2. Rinse the quinoa in cold water. Boil water in a saucepan, and then add the quinoa.\n3. Return to boil, and then simmer until the water is absorbed, 10 to 15 minutes. Cool for 15 minutes.\n4. While quinoa is cooking, mix olive oil, lime juice, cumin, coriander, chopped cilantro, and scallions in a small bowl, and set aside.\n5. Combine chopped vegetables with the black beans in a large bowl, and set aside.\n6. Once quinoa has cooled, combine all ingredients and mix well.\n7. Cover and refrigerate until ready to serve.\n\nSource: recipe by Delicious Heart-Healthy Latino Recipes, US Department of Health and Human Services, National Heart, Lung, and Blood Institute. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/quinoa-and-black-bean-salad), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Quinoa and Black Bean Salad. Recipe source: Delicious Heart-Healthy Latino Recipes, US Department of Health and Human Services, National Heart, Lung, and Blood Institute. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Lentil Tacos | تاكو العدس",
"text": "Vegan recipe: Lentil Tacos (Arabic name: تاكو العدس). Type: main dish. Makes 6 servings; serving size: 1/6 of recipe (281g).\nNutrition per serving (USDA panel): 193 kcal, 14 g protein, 13 g fiber.\nAbout: Lentils and raisins are an surprising and delicious duo in these sweet and savory tacos. Green peppers add extra flavor and texture. Enjoy with a tossed salad on the side.\n\nIngredients for Lentil Tacos:\n- 1 1/2 cups dry lentils (sorted and rinsed)\n- 4 cups water\n- 1/2 green pepper (chopped)\n- 4 cloves garlic (minced)\n- hot pepper flakes (1/2 teaspoon, optional)\n- 1 teaspoon chili powder\n- 1 teaspoon cumin\n- 1/2 teaspoon basil\n- 2/3 cup tomato paste, low-sodium\n- 1/4 cup raisins (optional)\n\nDirections for Lentil Tacos:\n1. Wash hands with soap and water.\n2. Cook lentils in 3 cups water for 10 minutes.\n3. Add remaining ingredients and simmer for 30 minutes. Add more water if necessary.\n4. Serve with corn tortillas. Can also be served over rice or noodles.\n\nYara note: Alternate seasoning (from the USDA page): 2 tablespoons taco seasoning instead of the other spices. The nutrition figures are for the filling, without tortillas.\nCheck the label: Taco seasoning and tortillas vary by brand: check for milk, cheese powder or lard.\nThe Yara website also has a version of this recipe adapted for Saudi supermarkets.\n\nSource: recipe by Washington State WIC Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/lentil-tacos), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Lentil Tacos. Recipe source: Washington State WIC Program. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Peanut Stew | يخنة الفول السوداني بالبطاطس",
"text": "Vegan recipe: Peanut Stew (Arabic name: يخنة الفول السوداني بالبطاطس). Type: main dish. Makes 6 servings; serving size: 1 serving.\nNutrition per serving (USDA panel): 353 kcal, 12 g protein, 7 g fiber.\nAbout: A hearty stew combining creamy peanut butter, hearty vegetables, and spices. Perfect for a chilly evening, it brings the warmth of garlic, ginger, and cumin to your table for a satisfying meal.\n\nIngredients for Peanut Stew:\n- 1 yellow onion, diced\n- 1 tablespoon olive oil\n- 1 tablespoon ginger, minced\n- 1 tablespoon garlic, minced\n- 1 teaspoon ground cumin\n- 1/2 teaspoon salt\n- 1/2 cup peanut butter\n- 1/2 cup tomato paste\n- 1 can diced tomatoes (about 15 oz)\n- 4 cups low sodium vegetable broth\n- 2 pounds whole yellow or red potatoes, peeled, halved, and cut into quarters (about 6 potatoes)\n- 2 cups kale, roughly chopped\n- 1/4 cup peanuts, chopped\n- 1 whole lime, zest and juice\n\nDirections for Peanut Stew:\n1. Heat oil over medium heat in a pot and add onions. Cook for a few minutes.\n2. Add ginger and garlic. Cook for 1-2 minutes. Add cumin and salt.\n3. Add peanut butter, tomato paste, diced tomatoes, and vegetable broth.\n4. Bring to a boil and add potatoes.\n5. Simmer for 15-20 minutes or until potatoes are fork-tender and cooked through.\n6. Add kale, and continue to cook for 1-2 minutes.\n7. Serve garnished with lime zest, lime juice, and crushed peanuts; drizzle with Sriracha for a spicy kick (optional).\n\nYara note: From the USDA page: yellow and red potatoes stay fork tender in this stew; russet potatoes may fall apart.\nCheck the label: Vegetable broth and stock cubes vary by brand: some contain chicken fat or milk.\n\nSource: recipe by Potatoes USA, a member of the MyPlate National Strategic Partnership Program. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/peanut-stew), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Peanut Stew. Recipe source: Potatoes USA, a member of the MyPlate National Strategic Partnership Program. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Lentil Barley Soup | شوربة العدس والشعير",
"text": "Vegan recipe: Lentil Barley Soup (Arabic name: شوربة العدس والشعير). Type: soup. Makes 6 servings; serving size: 2 cups.\nNutrition per serving (USDA panel): 330 kcal, 19 g protein, 20 g fiber.\nAbout: A big pot of lentils, tomatoes, and pearl barley simmer into this hearty soup. A great \"make ahead\" for quick meals and easy clean up.\n\nIngredients for Lentil Barley Soup:\n- 2 cups dried lentils (rinsed)\n- 4 scallions\n- 5 carrots (chopped)\n- 2 teaspoons dried oregano\n- 1/2 cup pearl barley\n- 12 cups water\n- 1 can 14.5 ounce low-sodium whole peeled tomatoes (coarsely chopped)\n- 1 tablespoon red wine vinegar\n- 1/2 teaspoon salt\n\nDirections for Lentil Barley Soup:\n1. Place a large soup pot on the stove and add lentils, scallions, carrots, celery, oregano, barley, and water. Bring to a boil.\n2. Reduce the heat to low and simmer, uncovered, for one hour.\n3. Add the tomatoes and continue cooking about 45 minutes. Just before serving, add vinegar.\n\nYara note: The published directions mention celery, but the ingredient list doesn't give an amount; a stalk or two works. Pearl barley (شعير مقشور) is sold in Saudi supermarkets.\n\nSource: recipe by USDA Center for Nutrition Policy and Promotion. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/lentil-barley-soup), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Lentil Barley Soup. Recipe source: USDA Center for Nutrition Policy and Promotion. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Curried Squash Stew | يخنة القرع بالكاري",
"text": "Vegan recipe: Curried Squash Stew (Arabic name: يخنة القرع بالكاري). Type: main dish. Makes 4 servings; serving size: 1 1/2 cup servings.\nNutrition per serving (USDA panel): 240 kcal, 11 g protein, 13 g fiber.\nAbout: Curry powder and cinnamon give unique flavor to this zucchini, butternut squash, tomato, and bean stew. Add raisins or dried cranberries for an added \"sweet note.\"\n\nIngredients for Curried Squash Stew:\n- 1 tablespoon vegetable oil\n- 1 yellow onion (peeled and chopped)\n- 2 cloves garlic (peeled and minced)\n- 1 celery stalk (including leaves, chopped)\n- 1/2 teaspoon ground cinnamon\n- 1 large zucchini (or 2 small)\n- 2 tablespoons curry powder\n- 3 cups butternut squash\n- 1 can (14.5 ounce) low-sodium diced tomatoes (including liquid)\n- 1 can (15.5 ounce) low-sodium white beans or chickpeas (drained and rinsed)\n\nDirections for Curried Squash Stew:\n1. Heat a large pot on the stove over medium heat and add oil. Add the onion, garlic and celery and cook about 10 minutes, until the onion is tender.\n2. Add zucchini and curry powder and cook for 10 minutes, stirring occasionally.\n3. Add the butternut squash, tomatoes and chickpeas and cover. Continue cooking about 10 minutes.\n4. Serve with cooked brown rice.\n\nYara note: From the USDA page: for additional flavor, add 1/2 cup raisins.\n\nSource: recipe by USDA Center for Nutrition Policy and Promotion. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/curried-squash-stew), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Curried Squash Stew. Recipe source: USDA Center for Nutrition Policy and Promotion. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-myplate-vegan-recipes.md",
"title": "MyPlate recipe: Eggplant Stir Fry | باذنجان مقلّب بالخضار",
"text": "Vegan recipe: Eggplant Stir Fry (Arabic name: باذنجان مقلّب بالخضار). Type: side dish. Makes 4 servings; serving size: 1/4 of recipe (497g).\nNutrition per serving (USDA panel): 238 kcal, 7 g protein, 13 g fiber.\nAbout: Fresh vegetables are cooked in one pan to create a flavorful side dish.\n\nIngredients for Eggplant Stir Fry:\n- 2 eggplants, peeled and cubed\n- 1 zucchini, thinly sliced\n- 1 cup green bell pepper, cut into strips\n- 2 onions, sliced\n- 3 tablespoons Italian salad dressing, low fat\n- 2 cups cherry tomatoes\n- 2 cups cooked brown rice\n\nDirections for Eggplant Stir Fry:\n1. Wash hands with soap and water.\n2. Place eggplant, zucchini, green bell pepper, onions and salad dressing into a skillet.\n3. Stir lightly to combine and cook over low heat until tender.\n4. Stir in cherry tomatoes and cook for 3-5 minutes. Serve over cooked brown rice.\nCheck the label: Italian salad dressing varies by brand: some contain cheese, milk or egg. Use a vegan one, or olive oil with vinegar and dried Italian herbs.\n\nSource: recipe by Farm Fresh Summertime Recipes, adapted from Easy Eggplant Stir Fry, Connecticut Food Policy Council. Published by the U.S. Department of Agriculture on MyPlate Kitchen (https://myplate-prod.azureedge.us/recipes/eggplant-stir-fry), public domain. Citation: U.S. Department of Agriculture. MyPlate Kitchen Website. Eggplant Stir Fry. Recipe source: Farm Fresh Summertime Recipes, adapted from Easy Eggplant Stir Fry, Connecticut Food Policy Council. Available at MyPlate.gov/MyPlateKitchen. Access date: 2026-11-09."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi situation: beginner curious about veganism | مبتدئ يريد تجربة الأكل النباتي",
"text": "Yara guide for Saudi situations: a beginner who is curious about veganism.\nكلمات بحث: مبتدئ، أبغى أبدأ نباتي، وش يعني نباتي، فيغن، الفرق بين النباتي والفيغن\nGoal: explain without overwhelming. Start with one easy meal and one grocery swap. Clarify vegan versus vegetarian when useful: vegan avoids meat, poultry, fish, dairy, eggs, and other animal-derived ingredients.\nRespect different reasons for plant-based eating: animals, health, environment, religion, budget, taste, or curiosity. Celebrate small steps: one plant-based meal still counts."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi situation: budget-conscious student | طالب بميزانية محدودة",
"text": "Yara guide for Saudi situations: a budget-conscious student.\nكلمات بحث: طالب، ميزانية، رخيص، اقتصادي، أكل رخيص، فلوس قليلة\nPrioritize lentils, ful, beans, chickpeas, rice, oats, bulgur, potatoes, bread, frozen vegetables, and seasonal produce. Avoid assuming tofu, vegan cheese, or protein powders are affordable or available."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi situation: gym user asking for protein | رياضي يسأل عن البروتين",
"text": "Yara guide for Saudi situations: a gym user asking for protein.\nكلمات بحث: جيم، بروتين، عضلات، تمارين، رياضة، كم بروتين\nAsk body goals only when needed. Give approximate protein per serving and a meal structure. Do not promise that a recipe alone guarantees a daily target. Ask whether the user wants a snack, meal, or full-day plan.\nFor a high-protein plan: ask whether the user wants one meal, one day, or a weekly plan; use several protein sources across the day; state that numbers are estimates; avoid medical claims."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi situation: Ramadan and fasting | رمضان والصيام",
"text": "Yara guide for Saudi situations: Ramadan, iftar, suhoor and fasting.\nكلمات بحث: رمضان، سحور، فطور، إفطار، صيام، صايم\nOffer suhoor and iftar ideas with hydration, carbohydrates, protein, and fiber. Suggest slow-digesting foods such as oats, lentils, beans, whole grains, and fruit. Do not give medical fasting instructions. Users with diabetes, pregnancy, kidney disease, medication needs, or other conditions should consult a clinician.\nPlant-based Ramadan meal pattern:\n- Iftar: water and dates if desired, lentil soup, a small serving of samboosa, salad, and a main dish such as lentil kabsa.\n- Between meals: fruit, soy yogurt, or roasted chickpeas.\n- Suhoor: ful or hummus, whole-grain bread, vegetables, and unsweetened fortified soy milk or oats.\nThis is general food planning, not medical fasting advice. People with medical conditions or prescribed diets should consult a clinician."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi situation: family or social pressure | العائلة والمناسبات والولائم",
"text": "Yara guide for Saudi situations: family meals, invitations and social pressure.\nكلمات بحث: العائلة، الأهل، عزيمة، وليمة، مناسبة، أهلي ما يتقبلون\nOffer a shared dish with an optional animal-protein side instead of framing the family as an enemy. Suggest familiar foods such as ful, hummus, lentil soup, rice dishes, falafel, vegetable stews, and salads. Respect that household kitchens may not be fully vegan."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi situation: eating at restaurants | الأكل في المطاعم",
"text": "Yara guide for Saudi situations: eating at restaurants and ordering vegan food.\nكلمات بحث: مطعم، مطاعم، طلب أكل، وش أطلب، نباتي في المطعم\nTell the user to ask about butter, ghee, cream, cheese, egg mayonnaise, chicken stock, fish sauce, and shared grills or fryers. \"Vegetarian\" does not always mean vegan. Give a short Arabic question they can show staff:\n«هل الطبق نباتي بالكامل؟ بدون حليب، زبدة، سمن، بيض، أو مرق دجاج/لحم؟»\nMeaning: \"Is the dish fully vegan, without milk, butter, ghee, eggs, or chicken/meat stock?\"\nCommercial mutabbaq may contain egg or meat; ask before ordering. Restaurant falafel may share oil with non-vegan foods; ask if that matters to the user. Do not assume restaurant bread is vegan; ask about milk, butter, ghee, or egg."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi situation: busy worker | موظف مشغول",
"text": "Yara guide for Saudi situations: a busy worker with little time to cook.\nكلمات بحث: مشغول، دوام، وقت قليل، أكل سريع، وجبة سريعة\nOffer ten-minute meals, leftovers, canned legumes, frozen vegetables, bread, hummus, and microwave-friendly options. Suggest batch cooking only if it truly saves time."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi situation: hot weather, delivery and food storage | الحر والتوصيل وحفظ الطعام",
"text": "Yara guide for Saudi situations: hot weather, delivery and keeping food safe.\nكلمات بحث: حر، صيف، توصيل، حفظ الأكل، ثلاجة، أكل خربان\nRemind users to protect chilled tofu, plant milk, hummus, and cooked food from heat. Suggest insulated bags and prompt refrigeration.\nCool cooked rice and legumes promptly, refrigerate in shallow containers, and follow safe food-storage practices. Keep chilled plant milk, tofu, hummus, and prepared food cold during transport in Saudi heat. When in doubt about food safety, discard it rather than taste-testing a suspicious container."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi-inspired vegan versions: how to label them | الأطباق المستوحاة من المطبخ السعودي",
"text": "Yara guide: labeling Saudi-inspired vegan dishes and checking packaged food.\nكلمات بحث: أكل سعودي نباتي، كبسة نباتية، أكلات شعبية، مكونات مخفية\nPlant-based adaptations are inspired by Saudi and wider Gulf ingredients and food traditions. They are not claims that every traditional version is historically vegan or that one recipe represents all Saudi regions. Yara should say \"Saudi-inspired vegan version\" when appropriate.\nCheck packaged stock, bread, spice mixes, sauces, and pastry for dairy, eggs, ghee, chicken stock, beef stock, fish sauce, and other animal ingredients."
},
{
"file": "yara-saudi-context.md",
"title": "Plant-based swaps for meat and dairy | بدائل نباتية للحوم والألبان",
"text": "Yara guide: ingredient substitutions for plant-based cooking.\nكلمات بحث: بديل اللحم، بديل الدجاج، بديل الحليب، بدائل نباتية\n- Lentils can replace minced meat in rice dishes, fillings, and stews.\n- Chickpeas can replace chicken pieces in bowls and salads.\n- TVP or soy chunks can replace minced or shredded meat when available.\n- Mushrooms add umami and texture but should be paired with beans or lentils for protein.\n- Soy milk creates a more protein-rich creamy sauce than rice or coconut milk.\n- Bulgur is often a practical substitute for more expensive imported grains."
},
{
"file": "yara-saudi-context.md",
"title": "Spice profile for Saudi-inspired vegan cooking | بهارات الطبخ النباتي بنكهة سعودية",
"text": "Yara guide: spices for Saudi-inspired vegan cooking.\nكلمات بحث: بهارات، كمون، هيل، لومي، بهارات الكبسة\nCommonly useful flavors include cumin, coriander, black pepper, cinnamon, cardamom, turmeric, dried lime/loomi, bay leaf, paprika, chili, garlic, lemon, tomato, and fresh coriander. Spice intensity should be adjusted to the user. \"Saudi-inspired\" does not require every spice in every dish."
},
{
"file": "yara-saudi-context.md",
"title": "Saudi culture and language | الثقافة واللغة",
"text": "Yara guide: Saudi cultural and language guidance.\nكلمات بحث: ثقافة، لهجة، حلال، دين\n- Use respectful Arabic and avoid caricaturing Saudi dialects.\n- Do not assume the user is Muslim, but halal and ingredient transparency may matter to many users.\n- Do not claim that every traditional Saudi dish is vegan. Label adaptations as \"Saudi-inspired vegan version.\"\n- Do not treat \"healthy,\" \"clean,\" or \"natural\" as regulated nutritional claims.\n- Avoid political, religious, or cultural arguments unless the user explicitly asks."
},
{
"file": "yara-saudi-context.md",
"title": "Nutrition safety boundaries | حدود السلامة الغذائية",
"text": "Yara guide: what Yara can and cannot advise on nutrition and health.\nكلمات بحث: صحة، مرض، حامل، سكري، كلى، حساسية، دكتور، أخصائي تغذية، رجيم\nYara can provide general food information, recipes, rough protein estimates, meal-planning ideas, and label-check reminders. Yara must not diagnose disease, prescribe supplements or medication, guarantee weight loss, recommend extreme restriction, or replace a doctor or registered dietitian.\nWhen the user mentions an eating disorder, severe symptoms, pregnancy complications, diabetes medication, kidney disease, serious allergy, or a prescribed therapeutic diet, give a short safe response and recommend professional help.\nFor children and teenagers, avoid aggressive calorie targets and weight-loss instructions. Encourage balanced meals and trusted adult or professional support."
}
];

const SYSTEM_PROMPT = `You are Yara, a Saudi-first plant-based companion. You help people eat more plant-based or fully vegan meals in Saudi Arabia, respecting their budget, protein goals, family situation, culture, time and what local supermarkets sell. You are friendly, warm, motivating and lightly humorous, never judgmental: like a helpful friend who knows the local supermarket aisle, not a strict nutrition lecturer.

Information you can use:
{{CONTEXT}}

Grocery prices (live list):
{{PRICES}}

How to answer:
1. Answer the user's question first. Keep it short and practical.
2. Use the user's language: English gets English, Arabic gets Arabic, mixed gets a natural mix. Understand Arabizi (abgha, wsh, bkam, ma3ndi, ma fi) and reply in clear Arabic or mixed Arabic/English. Never mock spelling.
3. Recipes: use only recipes from the information above and copy their names exactly. Never invent a recipe. For general requests, list up to 5 names. For a meal type, list only matching recipes. When you share a USDA MyPlate recipe, mention its source.
4. When you describe a recipe, mention only ingredients written in the information above. Never add meat, dairy, yogurt, eggs or honey.
5. Prices: give a price only from the grocery prices list, copying the product, store, pack size, SAR price and checked date. Never estimate or give price ranges. If the list says NO_PRICE_MATCH, say Yara has no price for that yet. Questions like "بكم", "كم سعر", "how much is" or "price of" are about prices: answer them from the grocery prices list.
6. If the answer isn't in the information, say "I couldn't find that in Yara's files." (Arabic: «لم أجد ذلك في ملفات يارا.») Then suggest something that is there.
7. Never shame anyone for eating non-vegan food, having a small budget, or changing goals. One plant-based meal still counts.
8. Don't diagnose, prescribe supplements or give medical fasting advice. For pregnancy, diabetes, kidney disease, eating disorders, serious allergies or prescribed diets, give a short safe answer and suggest a doctor or dietitian.
9. Ask at most one follow-up question, and only when needed. Light humor is welcome, sparingly, never when the user is upset.

Remember: answer in the user's language.`;

/* ---------- text helpers (same normalisation as the old price code) ---------- */
const PREFIXES = ['وال', 'بال', 'لل', 'ال', 'و', 'ب'];
// Arabizi and common spellings people type, mapped to words in Yara's files
const ALIASES = { '3ads': 'عدس', '3adas': 'عدس', adas: 'عدس', '7omos': 'حمص', '7ommos': 'حمص', '7ummus': 'حمص', homos: 'حمص', hummu: 'حمص', foul: 'فول', fool: 'فول', ful: 'فول', ruz: 'ارز', roz: 'ارز', '3aish': 'خبز', khobz: 'خبز', tahina: 'طحينه', ta7ina: 'طحينه', shofan: 'شوفان', burghul: 'برغل', bulgur: 'برغل', mash: 'ماش', lobia: 'لوبيا', fasolia: 'فاصوليا', kabsa: 'كبسه', mujaddara: 'مجدره', mjadara: 'مجدره', suhoor: 'سحور', sohoor: 'سحور', iftar: 'افطار', ftoor: 'فطور' };
function norm(text) {
  return String(text || '').toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}
function words(text) {
  const out = new Set();
  for (let w of norm(text).match(/[a-z0-9]+|[\u0600-\u06FF]+/g) || []) {
    if (/^[a-z0-9]/.test(w)) {
      if (ALIASES[w]) out.add(ALIASES[w]);
      if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) w = w.slice(0, -2);
      else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
      out.add(w);
      if (ALIASES[w]) out.add(ALIASES[w]);
      continue;
    }
    out.add(w);
    for (const p of PREFIXES) { if (w.startsWith(p) && w.length - p.length >= 2) { out.add(w.slice(p.length)); break; } }
  }
  return out;
}
const isArabic = (s) => /[\u0600-\u06FF]/.test(s || '');

/* ---------- knowledge search (BM25 over the ### sections) ---------- */
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'it', 'its', 'me', 'my', 'i', 'you', 'what', 'how', 'can', 'do', 'does', 'some', 'any', 'give', 'please', 'want', 'need', 'about', 'this', 'that', 'be', 'at', 'from', 'by', 'as', 'yara',
  'في', 'من', 'على', 'عن', 'الى', 'الي', 'ما', 'هل', 'ابي', 'ابغي', 'ابغا', 'وش', 'كيف', 'هذا', 'هذي', 'هذه', 'او', 'مع', 'لي', 'انا', 'انت', 'يارا', 'شي', 'عندي', 'ممكن', 'لو', 'كل']);
const tokens = (text) => [...words(text)].filter((w) => w.length > 1 && !STOP.has(w));
let INDEX = null;
function buildIndex() {
  const docs = KNOWLEDGE.map((s) => {
    const tf = new Map();
    const add = (w, n) => tf.set(w, (tf.get(w) || 0) + n);
    tokens(s.title).forEach((w) => add(w, 3));
    for (const w of norm(s.text).match(/[a-z0-9]+|[\u0600-\u06FF]+/g) || []) for (const v of words(w)) if (v.length > 1 && !STOP.has(v)) add(v, 1);
    let len = 0; tf.forEach((n) => { len += n; });
    return { s, tf, len };
  });
  const df = new Map();
  docs.forEach((d) => d.tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)));
  const avg = docs.reduce((a, d) => a + d.len, 0) / docs.length;
  INDEX = { docs, df, avg, n: docs.length };
}
function bm25(queryTerms) {
  const { docs, df, avg, n } = INDEX; const k1 = 1.2, b = 0.75;
  return docs.map((d) => {
    let score = 0;
    for (const w of queryTerms) {
      const f = d.tf.get(w); if (!f) continue;
      const idf = Math.log(1 + (n - df.get(w) + 0.5) / (df.get(w) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
    }
    return score;
  });
}
function retrieve(latest, previous) {
  if (!INDEX) buildIndex();
  const a = bm25(tokens(latest));
  const p = previous ? bm25(tokens(previous)) : null;
  const general = /recipe|وصف|اكل|طبخ/.test(norm(latest));
  const ranked = INDEX.docs.map((d, i) => ({ d, score: (a[i] + (p ? 0.35 * p[i] : 0)) * (general && /^all yara|\(list\)/i.test(d.s.title) ? 1.6 : 1) }))
    .filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, TOP_K);
  let used = 0; const parts = [];
  for (const { d } of ranked) {
    const body = d.s.text.length > SECTION_CHARS ? d.s.text.slice(0, SECTION_CHARS) + '…' : d.s.text;
    const block = '### ' + d.s.title + '\n' + body;
    if (used + block.length > CONTEXT_CHARS && parts.length) break;
    parts.push(block); used += block.length;
  }
  return { context: parts.join('\n\n') || '(nothing relevant found)', titles: ranked.map((x) => x.d.s.title) };
}

/* ---------- prices (a faithful port of dify/price_lookup.py) ---------- */
const UNIT_SIZE = { g: 1, kg: 1000, ml: 1, l: 1000 };
const SKIP = new Set(['dry', 'canned', 'whole', 'fresh', 'the', 'and', 'with', 'of', 'for', 'in', 'at', 'pc']);
const STORES = { Lulu: ['lulu', 'لولو'], Carrefour: ['carrefour', 'كارفور', 'كارفورد'], Panda: ['panda', 'بنده', 'باندا', 'بندا'] };
const CHEAP = new Set(['cheap', 'cheapest', 'budget', 'value', 'protein', 'رخيص', 'ارخص', 'بروتين', 'ميزانيه']);
const PRICE_EN = ['price', 'cost', 'riyal', 'cheap', 'budget', 'expensive', 'bkam'];
const PRICE_AR = ['بكم', 'سعر', 'اسعار', 'بكام', 'ريال', 'رخيص', 'ارخص', 'غالي', 'فلوس', 'تكلف', 'يكلف'];
const ARABIZI = ['b kam', 'si3r', 's3r', 'as3ar'];

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim());
  return rows.filter((r) => r.length >= head.length - 1 && r[0]).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
function baseAmount(row) { const size = parseFloat(row.size || 0); return isNaN(size) ? 0 : size * (UNIT_SIZE[String(row.unit || '').trim().toLowerCase()] || 0); }
function perSar(row) { const protein = parseFloat(row.protein_per_100 || 0), price = parseFloat(row.price_sar); return !price || price <= 0 || isNaN(protein) ? 0 : baseAmount(row) * protein / 100 / price; }
function describe(row) {
  const price = parseFloat(row.price_sar); const unit = String(row.unit || '').trim();
  let text = `${row.name_en} (${row.name_ar}) at ${row.store === 'Lulu' ? 'LuLu' : row.store}: ${row.size} ${unit} for SAR ${price.toFixed(2)}`;
  const amount = baseAmount(row);
  if (amount) text += ` (SAR ${(price / amount * 1000).toFixed(2)} per ${['ml', 'l'].includes(unit.toLowerCase()) ? 'L' : 'kg'})`;
  text += `, checked ${row.checked}`;
  const age = (Date.now() - Date.parse(row.checked + 'T00:00:00Z')) / 86400000;
  if (age > 60) text += ' (older than 60 days)';
  return text;
}
function match(text, rows) {
  const q = words(text); const qn = norm(text);
  const storesHit = Object.keys(STORES).filter((name) => STORES[name].some((k) => qn.includes(k)));
  const scores = new Map();
  for (const r of rows) {
    const keys = new Set([...words(r.name_en), ...words(r.name_ar), ...words(String(r.id || '').replace(/-/g, ' '))]);
    let score = 0; for (const k of keys) if (!SKIP.has(k) && q.has(k)) score++;
    if (score) scores.set(r.id, Math.max(scores.get(r.id) || 0, score));
  }
  return { q, storesHit, scores };
}
function wantsPrice(text) {
  const t = norm(text);
  if ((t.match(/[a-z]+/g) || []).includes('sar')) return true;
  if ([...PRICE_EN, ...PRICE_AR, ...ARABIZI].some((k) => t.includes(k))) return true;
  if (t.includes('how much')) return !['protein', 'gram', 'calorie', 'water'].some((x) => t.includes(x));
  return Object.values(STORES).some((keys) => keys.some((k) => t.includes(k)));
}
function priceLookup(latest, earlier, rows) {
  if (!wantsPrice(latest)) return '';
  let { q, storesHit, scores } = match(latest, rows);
  // Follow-ups such as "their prices" or "and at Panda?" borrow the food from the earlier messages.
  if (!scores.size && earlier) {
    const before = match(earlier, rows);
    if (before.scores.size) { scores = before.scores; q = new Set([...q, ...before.q]); }
    if (!storesHit.length) storesHit = before.storesHit;
  }
  let picked = [];
  if (scores.size) {
    const best = Math.max(...scores.values());
    picked = rows.filter((r) => scores.get(r.id) === best);
    if (storesHit.length) { const here = picked.filter((r) => storesHit.includes(r.store)); if (here.length) picked = here; }
  } else if (storesHit.length) {
    picked = rows.filter((r) => storesHit.includes(r.store)).sort((a, b) => perSar(b) - perSar(a));
  } else if ([...q].some((w) => CHEAP.has(w))) {
    picked = [...rows].sort((a, b) => perSar(b) - perSar(a));
  }
  const lines = [];
  for (const r of picked.slice(0, 10)) { try { if (!isNaN(parseFloat(r.price_sar))) lines.push(describe(r)); } catch (e) { /* skip a broken row */ } }
  if (!lines.length) return 'NO_PRICE_MATCH: Yara has no price for this yet.';
  return 'The user is asking about prices. Answer with these exact prices, keeping every number, pack size, store and date:\n' + lines.join('\n');
}
async function loadPrices(env, ctx) {
  const url = env.PRICES_URL || DEFAULT_PRICES_URL;
  const cache = caches.default; const key = new Request(url);
  let res = await cache.match(key);
  if (!res) {
    res = await fetch(url, { cf: { cacheTtl: 600 } });
    if (!res.ok) throw new Error('prices ' + res.status);
    const copy = new Response(await res.clone().text(), { headers: { 'Cache-Control': 'max-age=600', 'Content-Type': 'text/csv; charset=utf-8' } });
    ctx.waitUntil(cache.put(key, copy));
  }
  return parseCSV(await res.text());
}

/* ---------- a small per-visitor speed limit (best effort, per Cloudflare location) ---------- */
const HITS = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 25;
  const list = (HITS.get(ip) || []).filter((t) => now - t < win);
  list.push(now); HITS.set(ip, list);
  if (HITS.size > 5000) HITS.clear();
  return list.length > max;
}

/* ---------- HTTP ---------- */
function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return { ok, headers: ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : { Vary: 'Origin' } };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const friendly = (ar, key) => ({
  busy: ar ? 'يارا مشغولة شوي، جرّب بعد دقائق 🌱' : 'Yara is a little busy. Try again in a few minutes 🌱',
  resting: ar ? 'يارا ارتاحت لليوم، ارجع لها بكرة 🌙' : 'Yara is resting for today. Come back tomorrow 🌙',
  oops: ar ? 'صار خطأ بسيط، جرّب مرة ثانية.' : 'Something went wrong. Please try again.'
})[key];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const c = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, name: 'Yara chat', model: env.MODEL || DEFAULT_MODEL, sections: KNOWLEDGE.length }, 200, c.headers);
    if (request.method !== 'POST' || url.pathname !== '/chat') return json({ error: 'not found' }, 404, c.headers);
    if (!c.ok) return json({ error: 'This site is not allowed to use Yara.' }, 403, c.headers);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400, c.headers); }
    const history = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE * 3) }));
    const last = history[history.length - 1];
    if (!last || last.role !== 'user' || !last.content.trim()) return json({ error: 'bad request' }, 400, c.headers);
    if (last.content.length > MAX_MESSAGE) return json({ error: 'message too long' }, 413, c.headers);
    const ar = isArabic(last.content);
    if (limited(request.headers.get('CF-Connecting-IP') || 'unknown')) return json({ error: friendly(ar, 'busy') }, 429, c.headers);
    if (!env.AI) return json({ error: 'The Workers AI binding called AI is missing.' }, 500, c.headers);

    const earlierUser = history.slice(0, -1).filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join('\n');
    const { context } = retrieve(last.content, earlierUser.split('\n').pop());
    let prices = '';
    try { if (wantsPrice(last.content)) prices = priceLookup(last.content, earlierUser, await loadPrices(env, ctx)); }
    catch (e) { prices = 'NO_PRICE_MATCH: the price list could not be loaded right now.'; }

    const system = SYSTEM_PROMPT.replace('{{CONTEXT}}', context).replace('{{PRICES}}', prices || '(not a price question)')
      + (ar ? '\nThe user wrote in Arabic: reply in Arabic.' : '');
    const earlier = history.slice(0, -1).slice(-HISTORY_TURNS * 2);
    const messages = [{ role: 'system', content: system }, ...earlier, { role: 'user', content: prices ? last.content + '\n\n' + prices : last.content }];
    const stream = body.stream !== false;

    try {
      const out = await env.AI.run(env.MODEL || DEFAULT_MODEL, { messages, max_tokens: 900, temperature: 0.2, stream });
      if (stream) return new Response(out, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', ...c.headers } });
      return json({ reply: (out && (out.response ?? out.result?.response)) || '' }, 200, c.headers);
    } catch (e) {
      const msg = String(e && e.message || e);
      const daily = /neuron|quota|daily|limit|4006|capacity/i.test(msg);
      return json({ error: friendly(ar, daily ? 'resting' : 'oops') }, daily ? 429 : 502, c.headers);
    }
  }
};

