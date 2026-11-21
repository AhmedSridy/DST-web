import React from 'react';
import { Calculator, Camera, ShieldCheck, Truck } from 'lucide-react';

export const ArabicUserGuideView: React.FC = () => {
  const roleGuides = [
    {
      role: '1. الموظف الميداني (Field Staff)',
      steps: [
        'فتح شاشة «كشف الصرف اليومي» واختيار المحافظة والتاريخ ثم إدخال أرصدة بداية اليوم ونهاية اليوم والتسوية لأصناف اليوريا والنترات والسلفات (الخانة الفارغة تبقى غير مسجلة).',
        'استخدام «قراءة أرقام كشف الصرف من الصور (OCR)» واختيار نوع الصورة (كشف كامل / بداية اليوم / نهاية اليوم / التسوية)، مع تدوير الصورة أو رفع عدة صفحات ومراجعتها قبل الإدراج.',
        'تسجيل الجرارات الواردة من شاشة «الجرارات والبوليصات» ومطابقة العدد الفعلي مع عدد البوليصة.',
        'يُحسب فرق التسوية ويُميَّز بصريًا تلقائيًا، وحقل «سبب الفرق» اختياري ولا يمنع الحفظ؛ عند الانتهاء اضغط «حفظ الكشف» ثم «إرسال للمراجعة» أو التصدير بصيغة Excel / Word / PDF.',
      ],
    },
    {
      role: '2. المشرف الميداني (Supervisor)',
      steps: [
        'مراجعة الكشوف المكتملة والتحقق من التنبيهات المنطقية وملاحظات فروقات التسوية في كشف الصرف اليومي.',
        'مراجعة شحنات الجرارات المسجلة والضغط على «اعتماد الشحنة» بعد التحقق من البوليصة والفحص، أو إزالة الشحنات غير المعتمدة ضمن محافظته.',
        'إدارة الجمعيات الزراعية من شاشة «الجمعيات والمراكز» لإضافة جمعية أو تعديلها أو إيقافها مؤقتًا (حذف ناعم يحافظ على تاريخ الأرصدة).',
        'تحويل حالة التقرير من «مكتمل» إلى «قيد المراجعة» تمهيدًا لاعتماد رئيس القطاع.',
      ],
    },
    {
      role: '3. رئيس القطاع / المدير العام (Chief)',
      steps: [
        'متابعة المخططات التفاعلية والأرصدة الختامية والكشوف المتأخرة ومقارنة الأيام من لوحة المتابعة ونافذة «📊 المتابعة والتحليل» (تظهر المحافظات في المخططات تلقائيًا بمجرد وجود جمعية مفعّلة واحدة على الأقل بها).',
        'مراجعة التقارير في «مركز الاعتمادات» ثم «اعتماد نهائي» أو «رفض» مع كتابة سبب الرفض.',
        'عند إعداد رابط HTTPS فعلي للمنظومة المركزية في الإعدادات، يمكن إرسال التقرير المعتمد عبر زر «إرسال مركزي» وتوثيق نتيجة الاتصال الفعلية في سجلات التكامل.',
      ],
    },
    {
      role: '4. مدير النظام والمشاهد (Admin / Viewer)',
      steps: [
        'إنشاء وتعديل وحذف المستخدمين والدعوات وتعيين النطاق الجغرافي والصلاحيات الدقيقة، وتصدير/استعادة النسخ الاحتياطية JSON من «الإدارة وسجل التدقيق».',
        'صلاحيات التصحيح الكاملة في كل الشاشات: تعديل وحذف التقارير اليومية (بما فيها المعتمدة) وإعادة فتح التقرير المعتمد إلى مسودة، وتعديل/إرجاع/حذف شحنات الجرارات (حتى المعتمدة نهائيًا)، وتعديل/حذف الصور المحللة وسجلات التكامل.',
        'خياران لحذف الجمعيات: «إيقاف» (حذف ناعم يحفظ الأرصدة التاريخية) أو «حذف نهائي» (لمدير النظام فقط وعند الاتصال بالإنترنت فقط، مع عرض عدد السجلات المرتبطة وتأكيد كتابي بالاسم).',
        'تبقى سجلات التدقيق (audit_logs) وحركة الاعتمادات (approvals) محمية ضد التعديل أو الحذف للجميع بمن فيهم مدير النظام. دور «مشاهد (Viewer)» يتيح المتابعة والتقارير دون تعديل.',
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          دليل الاستخدام الميداني لمنظومة DST
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          مرجع عملي خطوة بخطوة للموظف الميداني والمشرف ورئيس القطاع ومدير النظام
        </p>
      </div>

      {/* Formulas & Standards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-400 font-bold text-sm">
            <Calculator className="w-4 h-4" />
            <span>المعادلات المحاسبية الحاكمة</span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            <strong>المنصرف</strong> = بداية اليوم − نهاية اليوم
          </p>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            <strong>فرق التسوية</strong> = المنصرف − التسوية
          </p>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            <strong>فرق الشحنة (الجرارات)</strong> = العدد الفعلي − عدد البوليصة
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            معامل التحويل القياسي: 1 طن = 20 شيكارة (وزن الشيكارة 50 كجم).
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-400 font-bold text-sm">
            <Camera className="w-4 h-4" />
            <span>ضوابط القراءة الذكية (OCR)</span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            يدعم تدوير الصور قبل التحليل ورفع صفحات متعددة، مع مطابقة أسماء الجمعيات وعرض تنبيه «⚠ راجع» للثقة المنخفضة أو اختلاف عمود المنصرف دون أي تخمين للأرقام غير الواضحة.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-400 font-bold text-sm">
            <Truck className="w-4 h-4" />
            <span>العمل دون إنترنت (Offline PWA)</span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            عند انقطاع الشبكة في المواقع الميدانية، تحفظ التعديلات في طابور IndexedDB المحلي وتتم مزامنتها تلقائيًا فور عودة الاتصال.
          </p>
        </div>
      </div>

      {/* Role Workflows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {roleGuides.map((guide) => (
          <div
            key={guide.role}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3"
          >
            <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-sm">
              <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <h3>{guide.role}</h3>
            </div>
            <ol className="space-y-2 text-xs text-slate-700 dark:text-slate-300 list-decimal list-inside leading-relaxed">
              {guide.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
};
