# بررسی عمیق هفت منبع جدید برای ATL

تاریخ: 2026-11-04. نوع خروجی: تحقیق و پیشنهاد؛ بدون تغییر runtime، نصب محصول، اجرای مدل، پرداخت یا ایجاد automation.

این گزارش مکمل [بررسی قبلی](2026-11-04-atl-enhancement-review.md) است. کد checkout فعلی بررسی شد؛ HEAD در زمان بررسی `6b1d6968533b8ce60c2cdb2b4ebe11b67f52fd1b` بود و تغییرات محلی متعددی وجود داشت. بنابراین یافته‌های کد درباره همین فایل‌های مشاهده‌شده‌اند، نه تضمین رفتار remote یا نسخه منتشرشده.

## نتیجه تصمیم‌ساز

منابع جدید، ساخت یک graph engine یا تیم نقش‌های تازه را توجیه نمی‌کنند؛ ATL بسیاری از پایه‌ها را دارد. آورده تازه و عملی‌تر آن‌ها این است:

1. **یافته review یک موجودیت قابل پیگیری شود**؛ از فرضیه تا شاهد، repair، بازسنجی و در صورت لزوم rule پیشگیرانه.
2. **repair فقط بخش معیوب و وابستگی‌های واقعاً متأثر را باز کند**؛ خروجی سالم حفظ شود و اثبات یکپارچگی همچنان لازم بماند.
3. **مرجع و نسخه قواعد داوری ثبت شود**؛ task تحت بررسی نتواند بی‌صدا معیار موفقیت خودش را عوض کند.
4. **حلقه با نبود پیشرفت متوقف شود**؛ صرف باقی‌ماندن بودجه دلیل retry نباشد.
5. **هزینه و ظرفیت review روی پذیرش کار اثر بگذارد**؛ اتوماسیون نباید فقط صف کار بررسی‌نشده را بزرگ کند.
6. **دانش، تاریخ اعتبار و زنجیره تغییر تصمیم داشته باشد**؛ داشتن URL یا checked_at معادل تأیید جاری نیست.
7. **مراحل اختیاری harness با آزمایش حذف/اضافه ارزیابی شوند**؛ کنترل ضروری از سربار تاریخی تفکیک شود.

اولویت verifier واقعی، correction به enforcer و retrieval که در گزارش قبلی پیشنهاد شد پابرجاست. این گزارش جزئیات لایه review، repair و ارزیابی آن‌ها را دقیق‌تر می‌کند.

## چه چیزی واقعاً خوانده و راستی‌آزمایی شد؟

- متن کامل هر هفت مقاله در Chrome، شامل متن و نمونه‌کدهای نمایش‌داده‌شده خوانده شد. لینک Chase همان دوره‌ای است که قبلاً از مقاله دیگر به آن رسیده بودیم؛ در این بررسی نمونه‌های پیکربندی و workflow آن هم خوانده شدند.
- مقاله Sergii با حدود ۱۰۰ هزار کاراکتر، شامل تحلیل، فهرست محصول‌ها، معیار انتخاب و منابع خوانده شد. این به معنی audit مستقل هر ۶۳ محصول، قیمت یا ادعای فروشنده نیست.
- صفحه عمومی دوره Hanako باز شد و پیشنهاد دسترسی پولی را نشان می‌داد. ادعای ۲۰ درس از مقاله است؛ محتوای کامل دوره بررسی نشد و خریدی انجام نشد.
- ادعاهای تصمیم‌ساز با منابع رسمی Claude، xAI/Cursor، مستندات OpenAI و مقالات اصلی review مقایسه شدند. benchmark و قیمت‌های مقاله به عنوان نتیجه ATL پذیرفته نشدند.
- runtime، handoff، state، worker prompt، plan review، dispatcher، brain، governance، learning و evaluation فعلی ATL بررسی شدند. تست یا benchmark جدید محصول اجرا نشد؛ این گزارش مبتنی بر خواندن منبع و کد است.

## بررسی منبع به منبع

### S1 — Mr. Buzzoni: Claude Loop Engineering

**هسته مفید:** trigger، کار، gate، state پایدار و stop جداگانه تعریف شوند؛ ابتدا یک اجرای دستی قابل تکرار ساخته شود. معیار «هزینه هر تغییر پذیرفته‌شده» از شمارش اجرای agent مفیدتر است. مقاله همچنین ظرفیت review و بدهی فهم پروژه را مطرح می‌کند.

**تطبیق با ATL:** worker محدود، سقف session/time، state پایدار، نقش reviewer و supervisor از قبل وجود دارند. STATE.md تازه نباید مرجع دوم lifecycle شود. خروجی خواندنی را می‌توان از state فعلی تولید کرد.

**اصلاح برداشت:** evaluator هدف در Claude طبق مستندات، transcript را می‌خواند و خودش تست اجرا نمی‌کند [P1]. بنابراین `/goal` یا داور تازه به‌تنهایی شاهد runtime نیست. یک gate با exit code صفر هم فقط وقتی معتبر است که verifier رفتار موردنظر را واقعاً بسنجد. اعداد درآمد، بهره‌وری و داستان آزمایش‌های مقاله، توجیه بودجه ATL نیستند.

**آورده برای ATL:** توقف در نبود پیشرفت، سنجش ظرفیت review، و اتصال هزینه به نتیجه پذیرفته‌شده؛ جزئیات E4 و E5.

### S2 — Chase: تیم توسعه چندنقشی با GitHub

**هسته مفید:** baseline معلوم، قرارداد مشترک، worktree مستقل، ترتیب وابستگی، verification و review روی یک revision و تحویل با evidence. checkpoint باید برای محیط runner جدید هم قابل بازیابی باشد.

**تطبیق با ATL:** `handoffs.mjs` همین حالا source snapshot و evidence وابسته به revision دارد؛ revisionهای ATL می‌توانند hash محتوای dirty checkout باشند و نباید با Git commit SHA اشتباه شوند. گیت plan نیز fingerprint و کنترل تغییر هم‌زمان دارد. نیاز به کپی شش نقش دوره نداریم.

**حدود نمونه:** workflow نمونه، همه تضمین‌های نوشته‌شده در prompt را به کنترل اجرایی تبدیل نمی‌کند؛ دستور «checkpoint را remotely نگه دار» به ذخیره‌ساز و قرارداد recovery واقعی نیاز دارد. worktree هم container یا مرز امنیتی حساب/شبکه نیست. ابزار read-only reviewer باید با مأموریتش هماهنگ باشد: اگر اجازه اجرای تست ندارد، ادعای بازتولید نکند [P2].

**آورده برای ATL:** manifest دقیق ورودی/خروجی و سیاست review، همراه با سناریوی قطع و ادامه؛ E2 و E3.

### S3 — 0xwhrrari: Harness Engineering

**هسته مفید:** قرارداد کار، context انتخابی، ابزار با خطای مشخص، state پایدار، sensor، authorization بیرون مدل و trace. پیشنهاد change receipt نیز برای توضیح نتیجه مفید است.

**تطبیق با ATL:** بیشتر این اجزا موجودند؛ receipt باید نمای ترکیبی داده‌های فعلی باشد. گزارش token فعلی صریحاً missing telemetry را unknown نگه می‌دارد و هزینه واقعی صورت‌حساب را ادعا نمی‌کند.

**اصلاح مهم با منبع اصلی:** مقاله Anthropic که نویسنده ارجاع داده، از حذف بعضی scaffoldingها با بهترشدن مدل نتیجه می‌گیرد [P3]. بنابراین «اضافه‌کردن لایه» همیشه بهبود نیست. نقش متفاوت هم استقلال خطا را ثابت نمی‌کند؛ مدل، context و روش مشاهده باید معلوم باشند.

**آورده برای ATL:** receipt قابل بازپخش و نسخه‌دار، و آزمایش ارزش هر مرحله اختیاری؛ E2 و E7.

### S4 — 0xwhrrari: Grok Bot

**هسته مفید:** کار برگشت‌پذیر تا مرز اقدام consequential آماده شود؛ demonstration به routine دارای input، verifier و مرز اختیار تبدیل شود؛ automationهای بی‌فایده یا خراب بازبینی شوند.

**تطبیق با ATL:** governance برای skill تأییدشده و routine غیرفعال اولیه دارد. پیشنهاد این است که مشاهده اجرای موفق به candidate قابل بررسی تبدیل شود، نه اینکه هر trace به اسکریپت قابل اجرای فوری تبدیل شود.

**حدود:** صفحه و نام bot مستقل، جداسازی credential نمی‌سازد؛ مستندات رسمی shared computer و Vault این موضوع را تأیید می‌کنند [P4، P5]. برگشت‌پذیری تنها معیار permission هم نیست؛ مجوز کاربر، هویت، داده و مرز حساب اهمیت دارند. پنج اجرای تمیز، threshold نمونه مقاله است و تضمین آماری یا policy آماده ATL نیست.

**آورده برای ATL:** اعتبار زمانی و سلامت routine، و مراحل observation تا promotion؛ E4 و E8. از این منبع، مهاجرت ATL به Grok Bot نتیجه نمی‌شود.

### S5 — Hanako: Loops and Graphs

**هسته مفید:** کارهای مستقل منتظر هم نمانند، تبدیل‌های دقیق با کد انجام شوند، شکست به واحد تولیدکننده برگردد و درس معتبر به نحوه تقسیم کار آینده برسد.

**اصلاح‌های ضروری:** نبود متغیر داده بین دو مرحله، نبود dependency را ثابت نمی‌کند؛ shared resource، authorization، rate limit و ترتیب اثر خارجی هم edge می‌سازند. merge معنایی و رتبه‌بندی ریسک نیز همیشه پاسخ دقیق یگانه ندارند. بازگرداندن فقط واحد خراب باید closure وابستگی‌های متأثر و تست یکپارچه را پوشش دهد. سقف سه retry نمونه است؛ شکست سوم اثبات نمی‌کند علت حتماً plan است.

**تطبیق با ATL:** `plan_depends_on`، `check_owners` و handoffهای تأییدشده موجودند؛ بحث، دقیق‌ترکردن invalidation و repair است. توصیه مقاله به parallel agent در این گزارش اجرا نشد.

**آورده برای ATL:** E3 و learning دارای scope در E6. دوره تجاریِ لینک‌شده، شاهد قابلیت اجرایی محسوب نشده است.

### S6 — Sergii Makarevych: بررسی بازار AI Code Reviewer

**هسته مفید:** reviewer را با پنج محور ارزیابی کنیم: چه می‌خواند، چگونه findings را بررسی می‌کند، چه اختیاری دارد، چگونه یاد می‌گیرد و بر چه مبنایی هزینه می‌گیرد. از این متن، معماری و روش سنجش برای ATL مهم‌تر از جدول قیمت و انتخاب فروشنده‌اند.

**اصلاح تعمیم‌ها:** «همه محصولات» یا «هیچ محصولی» در survey، نتیجه نمونه‌های مشاهده‌شده نویسنده است. same-vendor بودن proxy ضعیف استقلال است؛ دو pipeline یک فروشنده ممکن است متفاوت باشند و دو مدل متفاوت فرض غلط مشترک داشته باشند. finding پذیرفته‌شده نیز الزاماً bug واقعی یا کاهش incident نیست.

دو منبع پژوهشی اصلی، احتیاط مقاله درباره benchmark را تقویت می‌کنند: SWE-PRBench محدودیت diff و افت عملکرد در تنظیمات context آزمایش‌شده را گزارش می‌کند [P8]. نتیجه AACR-Bench دقیق‌تر از تعبیر کلی survey است: بعضی ترکیب‌های مدل/retrieval precision را کم و بعضی بیشتر می‌کنند؛ روش agent هم می‌تواند precision بالاتر و recall پایین‌تر داشته باشد [P9]. این‌ها دلیل حذف context لازم نیستند؛ کیفیت و انتخاب آن باید سنجیده شود. c-CRAB از تست‌های held-out برای سنجش review استفاده می‌کند [P10].

**آورده برای ATL:** E1، E2، E5 و E7؛ نصب reviewer خارجی پیش از ساخت dataset و معیار محلی توجیه نشده است.

### S7 — Plusxbt: Second Brain با شاهد و تاریخ

**هسته مفید:** knowledge، منبع و تصمیم از هم قابل تشخیص باشند؛ decision قدیمی پاک نشود؛ missing evidence به پاسخ نامعلوم منجر شود. سه آزمون source tracing، تاریخ تصمیم و uncertainty برای eval حافظه مناسب‌اند.

**تطبیق با ATL:** source revision، claim status، stale scan و context pack موجودند. کمبود اصلی، رابطه صریح supersedes، اعتبار زمانی ادعا و retrieval است. اکنون اختلاف هر دو متن در یک subject می‌تواند conflict تلقی شود؛ دو گزاره مستقل درباره یک موضوع نیز ممکن است چنین وضعی پیدا کنند.

**حدود:** checked_at تاریخ بررسی است، نه تضمین جاری‌بودن. `/weekly-review` نمونه skill دستی است؛ `disable-model-invocation: true` آن را scheduler نمی‌کند [P6]. دستور «فقط با approval ویرایش کن» هم باید با authority واقعی محیط هماهنگ باشد، نه اینکه به همه workflowهای ATL درخواست تأیید تازه تحمیل کند.

**آورده برای ATL:** E6؛ حافظه Markdown موازی یا import گسترده همه یادداشت‌ها پیشنهاد نمی‌شود.

## قابلیت‌های پیشنهادی، با مرز و معیار پذیرش

### E1 — چرخه ساختاریافته finding؛ اولویت بالا

**وضعیت فعلی:** task review عمدتاً `result/detail` در evidence دارد؛ worker آخرین متن review را دریافت می‌کند. Plan Studio findings ساختاریافته دارد، اما این معادل چرخه finding برای کد task نیست.

**تغییر پیشنهادی:** شناسه ثابت، requirement، مسیر و revision، سناریوی شکست، نوع شاهد، وضعیت تأیید، repair و نتیجه بازسنجی ثبت شود. مسیر نمونه:

`candidate → confirmed / disproved / unverified → repair → independently rechecked → resolved`.

نوع شاهد صریح باشد: خواندن کد، نتیجه analyzer، تست اجراشده یا مشاهده runtime. نبود دسترسی به محیط، finding را به «بازتولیدشده» تبدیل نکند. صفر finding فقط با پوشش معلوم قابل تفسیر است؛ timeout، skip یا source ناقص هرگز review تمیز محسوب نشود.

**معیار پذیرش:** finding بدون شاهد، به‌طور خودکار confirmed نشود؛ تعمیر یک finding بقیه را resolved نکند؛ گزارش جدید روی revision دیگر، تأیید قدیمی را قرض نگیرد؛ timeout پوشش را partial/unknown کند. برای ایرادهایی که executable نیستند، استدلال و شاهد ایستا حفظ شود؛ تست شرط عمومی همه ایرادها نیست.

### E2 — منشأ سیاست داوری و receipt ترکیبی؛ اولویت بالا

**وضعیت فعلی:** manager، scoped worker channel، prompt نقش و plan fingerprint محافظت‌هایی دارند. این بررسی exploit یا دستکاری موفق را اثبات نکرد. شکاف پیشنهادی، کامل‌بودن ثبت منشأ دستورها در میان providerهاست.

**تغییر:** receipt نسخه/hash نقش، قواعد پروژه، policy، قرارداد، verifier، context pack، ورودی و خروجی را ثبت کند. قواعد معتبر baseline از تغییر پیشنهادی همان task جدا باشند. اگر task خودش policy یا verifier را تغییر می‌دهد، تغییر آن یک بخش صریح قرارداد و review باشد؛ candidate نتواند صرفاً معیار قبلی را حذف کند و pass بگیرد. مستندات رسمی Claude برای managed review خواندن دستورها از base/default branch را صریح کرده‌اند [P7].

این receipt باید از evidence و execution ledger فعلی ساخته شود؛ prompt و secret کامل را دوباره ذخیره نکند. نسخه CLI و environment در صورت مشاهده ثبت شوند؛ مقدار حدسی جای خالی را پر نکند.

**معیار پذیرش:** تغییر قواعد reviewer در candidate بدون مجوز قرارداد، gate قبلی را تغییر ندهد؛ ارتقای verifier یا policy، approval وابسته را به‌درستی stale کند؛ artifact مفقود با داشتن hash، available نشان داده نشود. replay گزارش با اجرای تازه مدل فرق داشته باشد.

### E3 — repair و invalidation بر اساس اثر؛ اولویت بالا

**وضعیت فعلی:** ATL dependency، ورودی revisionدار، snapshot و integration verification دارد. worker نیز مجاز است در scope task نقص integration را ترمیم کند. پیشنهاد نباید این مجوز را با قانون کور «فقط یک فایل» از بین ببرد.

**تغییر:** repair packet شامل finding ID، ورودی‌ها، output معیوب، محدوده مجاز، checks متاثر و علت انتخاب downstreamها باشد. واحد سالم با ورودی/قرارداد یکسان حفظ شود. تغییر API مشترک، checks همه مصرف‌کنندگان مرتبط را باز کند. edgeها علت داشته باشند: داده، کنترل/مجوز، منبع مشترک یا ترتیب اثر. دلیل dependency باید قابل توضیح باشد.

**معیار پذیرش:** در چهار بخش مستقل، خرابی یکی سه خروجی سالم را بازنویسی نکند؛ تغییر interface مشترک همه مصرف‌کنندگان مربوط را revalidate کند؛ تغییر ناشناخته fail-open نشود؛ تست یکپارچه روی خروجی نهایی باقی بماند. حفظ artifact به معنی حفظ خودکار همه approvalها نیست.

### E4 — توقف با نبود پیشرفت و سلامت routine؛ اولویت متوسط رو به بالا

**وضعیت فعلی:** سقف تلاش، session/time، retry محدود و containment پس از interruption موجودند. راه‌اندازی مجدد بدون مشاهده علت، حتی در سقف بودجه، می‌تواند بی‌فایده باشد.

**تغییر:** هر تلاش با code revision، failure signature، evidence جدید و تغییر وضعیت محیط مقایسه شود. شکست یکسان با ورودی و دسترسی یکسان به علت تکرار شود: خطای transient، repair واقعی، منع ابزار، prereq گمشده یا نیاز به تصمیم owner. تغییر صرف متن prompt «پیشرفت» محسوب نشود.

برای routine نیز عدم اجرا در زمان انتظار، اعتبار credential، نسخه skill، verifier drift و مصرف ثبت شود. pause/degrade نیازمند policy از پیش مجاز باشد؛ این تحقیق مجوز تغییر routine یا trust فعلی نیست. «بی‌خبر از کار افتادن» با «هیچ رویدادی نیامده» فرق داشته باشد.

**معیار پذیرش:** permission denial ثابت مصرف retry را ادامه ندهد؛ بعد از رفع واقعی prereq، مسیر resume وجود داشته باشد؛ kill پس از اثر نامعلوم به موفقیت یا retry بی‌قید تبدیل نشود؛ هشدار سلامت با نبود کار اشتباه نشود.

### E5 — ظرفیت review و اقتصاد خروجی پذیرفته‌شده؛ اولویت متوسط

**وضعیت فعلی:** concurrency/fairness، execution ledger و unknown token handling وجود دارد. این‌ها به‌تنهایی ظرفیت بررسی یا دلار واقعی صورت‌حساب نیستند.

**تغییر:** WIP و زمان انتظار review، نسبت کار نیازمند repair، مداخله انسان و نتیجه پذیرش کنار مصرف دیده شوند. با پرشدن صف review، شروع کار کم‌اولویت محدود شود و ظرفیت لازم برای تمام‌کردن review/verification حفظ شود؛ سقف سراسری concurrency جای این سیاست را نمی‌گیرد.

هزینه هر خروجی پذیرفته‌شده باید تلاش‌های شکست‌خورده، repair و بررسی را نیز شامل شود. هزینه واقعی فقط با billing قابل اتکا؛ در نبود آن token و coverage گزارش شوند. همچنین finding مفید، finding اصلاح‌شده و bug واقعی جدا بمانند؛ عدم اصلاح ممکن است از backlog یا اختلاف محصول باشد.

**معیار پذیرش:** اجرای تکراری ledger دوباره شمرده نشود؛ مصرف نامعلوم صفر نشود؛ ردشدن یا تغییر scope از مخرج حذف نشود؛ مقایسه دو مسیر با task class و بودجه قابل مقایسه انجام شود. throughput بدون کیفیت و تأخیر review معیار کافی نیست.

### E6 — دانش زمان‌مند و learning با دامنه؛ اولویت بالا، ادامه پیشنهاد قبلی

**تغییر:** claim/decision علاوه بر منبع، predicate یا نوع گزاره، دامنه، زمان مشاهده، تاریخ بررسی، شرط بازبینی و رابطه supersedes داشته باشد. ادعای منسوخ برای تاریخچه باقی بماند ولی پاسخ جاری آن را با active قاطی نکند. freshness بر اساس نوع ادعا باشد؛ قیمت و قرارداد پایدار یک TTL یکسان ندارند.

rule استخراج‌شده از finding نیز باید failure class، scope، owner، شاهد، کنترل پیشگیرانه، تاریخ بازبینی و راه برگشت داشته باشد. feedback منفی به‌تنهایی مجوز خاموش‌کردن کنترل نیست. اگر rule فقط reviewer را ساکت کند و علت را در generator/ابزار/معماری اصلاح نکند، خطا حل نشده است.

**معیار پذیرش:** دو fact مستقل در یک subject بی‌دلیل conflict نشوند؛ دو تصمیم واقعاً ناسازگار پنهان نمانند؛ سؤال درباره «تصمیم فعال» با «تصمیم در تاریخ گذشته» پاسخ متفاوت و مستند بگیرد؛ سؤال بدون شاهد، unknown شود؛ quotation یا وب‌سایت نتواند خودش به policy جدید تبدیل شود. recall فارسی/انگلیسی در بودجه context ثابت سنجیده شود.

### E7 — benchmark مخصوص review و آزمایش مراحل اختیاری؛ اولویت بالا پیش از انتخاب vendor

**وضعیت فعلی:** `evaluations/atl` موجود است؛ replay، grader مستقل و mutation دارد. گزارش فعلی صریحاً برتری ATL را در پایلوت کوچک نشان نداده و محدودیت‌های آن را ثبت کرده است. این داده به معنی ارزیابی review واقعی، provider زنده یا همه مسیرهای refactor نیست.

**تغییر:** taskهای held-out از تغییر سالم و bug واقعی با baseline مشخص ساخته شوند؛ شامل خطای cross-file، mismatch با spec، issue گمراه‌کننده، policy داخل diff، context ناقص و محیطی که تست در آن اجرا نشده است. raw prompt، مدل/provider، budget، instruction/verifier hashes، زمان و پوشش ثبت شوند. grader از candidate قابل ویرایش نباشد.

معیارها: recall روی defectهای معلوم، precision با نمونه‌برداری مستقل، شدت خطا، false-positive burden، زمان انسان، هزینه، نقض scope و defectهای فراری در window مشخص. review خالی را فقط روی تغییر واقعاً سالم پاداش بدهیم. عدم incident یا revert، به‌تنهایی نبود bug را ثابت نمی‌کند.

سپس با مدل و بودجه یکسان، بعضی مراحل اختیاری مثل extra critic، specialist fan-out یا context bundle بزرگ حذف/اضافه شوند. gateهای الزامی و اختیار owner در این آزمایش تضعیف نشوند. انتخاب مدل متفاوت یک شرط آزمایشی باشد، نه تضمین استقلال.

**معیار پذیرش:** no-op reviewer که هیچ finding نمی‌دهد، روی bugها شکست بخورد؛ reviewer پرحرف روی تغییر سالم precision از دست بدهد؛ reviewer فقط با تغییر قواعد خودش pass نگیرد؛ replay امتیاز با اجرای جدید provider اشتباه نشود؛ judge خودکار با نمونه‌های انسانی کالیبره شود.

### E8 — استخراج routine از یک اجرای موفق؛ اولویت بعدی

**تغییر:** trace اجرای مجاز به candidate skill با پارامتر، ورودی، خروجی، اثرها، approval boundary، verifier و rollback تبدیل شود. credential یا داده خصوصی و مختص یک اجرا در template نماند. promotion از governance موجود عبور کند؛ موفقیت یک نمونه مجوز unattended نیست. بررسی باید frontmatter، tool grant، hook و اجرای پویا را هم شامل شود؛ مستندات Claude می‌گویند `allowed-tools` می‌تواند مجوز بدون پرسش در همان turn بدهد، پس متن بی‌خطر body به‌تنهایی کافی نیست [P6].

**معیار پذیرش:** candidate با ورودی تازه و failure fixture آزموده شود؛ تغییر UI یا نسخه ابزار به silent success منجر نشود؛ مرز اقدام خارجی حفظ شود؛ extraction هرگز به‌تنهایی schedule ایجاد نکند. در محیط فعلی این قابلیت پس از تکمیل event bridge و verifier پیشنهاد می‌شود.

## ترتیب اجرای پیشنهادی

| مرحله | بسته | خروجی قابل سنجش |
|---|---|---|
| ۱ | verifier واقعی + E1 | یک finding واقعی از تشخیص تا اثبات repair روی revision نهایی |
| ۲ | E2 + E3 | repair محدود با artifacts سالم حفظ‌شده و سیاست داوری قابل ردیابی |
| ۳ | E6 | سه آزمون حافظه: منبع، تصمیم فعال و نبود شاهد؛ سپس سنجش retrieval |
| ۴ | E4 + event bridge قبلی | اجرا، interruption، replay و توقف بدون پیشرفت با شواهد روشن |
| ۵ | E5 + E7 | مقایسه کنترل‌شده کیفیت/هزینه و ظرفیت review روی کار واقعی |
| ۶ | E8 و adapter اختیاری | routine قابل اعتماد و سازگاری بیشتر، پس از اثبات نیاز |

نقطه شروع پیشنهادی من **یک مسیر عمودی review→finding→repair→reverify** است. این مسیر هم verifier را به کار می‌گیرد، هم شکاف findings را آشکار می‌کند، هم پایه اندازه‌گیری هزینه کار پذیرفته‌شده می‌شود. تخمین درصد بهبود یا صرفه‌جویی پیش از اجرای چنین آزمایشی قابل دفاع نیست.

## منابع

### ورودی‌های کاربر

- [S1 Mr. Buzzoni](https://x.com/Mr_Buzzoni/status/2083061585858158636)
- [S2 Chase](https://x.com/0xChaseTM/status/2109980695787454803)
- [S3 0xwhrrari / Harness](https://x.com/0xwhrrari/status/2093685107534000560)
- [S4 0xwhrrari / Grok Bot](https://x.com/0xwhrrari/status/2095497109524934750)
- [S5 Hanako](https://x.com/hanakoxbt/status/2091515787366306154) و [صفحه دوره، محتوای کامل قفل بود](https://agent-layers.vercel.app/)
- [S6 Sergii](https://x.com/sermakarevich/status/2117599472188350701)
- [S7 Plusxbt](https://x.com/plusxbt/status/2117565904951148756)

### منابع اولیه خوانده‌شده

- [P1 Claude / goal](https://code.claude.com/docs/en/goal)
- [P2 Claude / subagents](https://code.claude.com/docs/en/sub-agents)
- [P3 Anthropic / Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [P4 xAI / Approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- [P5 Cursor / Secrets](https://cursor.com/help/grok-bot/secrets)
- [P6 Claude / Skills](https://code.claude.com/docs/en/skills)
- [P7 Claude / Code review](https://code.claude.com/docs/en/code-review) و [Customize Code Review، مرجع branch قواعد](https://code.claude.com/docs/en/code-review-customize)
- [P8 SWE-PRBench](https://arxiv.org/abs/2603.26130)
- [P9 AACR-Bench](https://arxiv.org/abs/2601.19494)
- [P10 c-CRAB](https://arxiv.org/abs/2603.23448)
- [P11 ReviewBench methodology](https://github.com/review-bench/ReviewBench/blob/main/docs/METHODOLOGY.md)
- [P12 Codex / custom code review rules](https://developers.openai.com/blog/custom-code-review-rules-for-codex)
- [P13 Claude / scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)
- [P14 karpathy/autoresearch README](https://github.com/karpathy/autoresearch)
- [P15 Cursor / Bugbot](https://cursor.com/docs/bugbot)
- [P16 xAI / Skills, routines and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [P17 Claude / Memory](https://code.claude.com/docs/en/memory)

### نقاط اصلی تطبیق محلی

- `runtime/lib/state.mjs:addEvidence` — ساختار فعلی evidence و کنترل نقش‌ها.
- `runtime/lib/worker.mjs:promptFor` — قرارداد نقش، review پیشین، context و مرزهای worker.
- `runtime/lib/handoffs.mjs` — snapshot، revision، input و verification یکپارچه.
- `runtime/lib/plan-studio.mjs:reviewPlanArtifact/planReviewSnapshotCurrent` — findings برنامه و fingerprint review.
- `runtime/lib/task-changes.mjs:evidenceFor` و `docs/task-change-review.md` — stale/unknown، محدودیت preview و تصمیم‌های ساختاریافته هنوز ناموجود در این نما.
- `runtime/lib/brain.mjs:addClaim/buildContextPack` و `governance.mjs` — claim، conflict، retrieval و freshness.
- `runtime/lib/learning.mjs`، `feedback.mjs` و `research.mjs:scanRetros` — درس، feedback و retrospective موجود.
- `runtime/lib/execution-report.mjs` و `docs/execution-reports.md` — ledger، coverage و calibration فعلی.
- `runtime/lib/dispatcher.mjs`، `supervisor-runner.mjs`، `routines.mjs` — dispatch، سقف‌ها، recovery و schedule موجود.
- `evaluations/atl/README.md` و `SUMMARY.fa.md` — روش و محدودیت‌های پایلوت فعلی.

این فایل یک brief پژوهشی است؛ task رسمی، spec تأییدشده، مجوز اجرای provider یا تغییر سطح autonomy ایجاد نمی‌کند.
