import type {
  AgriculturalAssociation,
  ApprovalRecord,
  AuditLogEntry,
  CenterVillage,
  DailyDisbursementRow,
  DailyReport,
  FertilizerType,
  Governorate,
  GovernorateCenter,
  ImageAttachmentRecord,
  IntegrationLogEntry,
  RoleDefinition,
  SystemSettings,
  TractorDelivery,
} from '../types/domain.ts';
import { normalizeArabicName } from '../utils/arabicNormalize.ts';

export const SEED_ROLES: RoleDefinition[] = [
  {
    id: 'role-field_staff',
    code: 'field_staff',
    nameAr: 'موظف ميداني',
    descriptionAr: 'إدخال كشف الصرف اليومي، تسجيل الجرارات والبوليصات، واستخدام القراءة الذكية OCR.',
    permissions: ['edit_daily_sheet', 'use_ocr', 'create_tractor', 'submit_report'],
  },
  {
    id: 'role-supervisor',
    code: 'supervisor',
    nameAr: 'مشرف',
    descriptionAr: 'مراجعة الكشوف، إدارة الجمعيات، اعتماد استلام الجرارات، ومعالجة الفروقات.',
    permissions: ['manage_associations', 'approve_tractor', 'review_report', 'resolve_variance'],
  },
  {
    id: 'role-chief',
    code: 'chief',
    nameAr: 'رئيس قطاع / مدير عام',
    descriptionAr: 'الاعتماد النهائي للتقارير اليومية أو رفضها مع ذكر السبب، والإرسال للنظام المركزي.',
    permissions: ['approve_report', 'reject_report', 'sync_central', 'view_reports'],
  },
  {
    id: 'role-viewer',
    code: 'viewer',
    nameAr: 'مشاهد',
    descriptionAr: 'الاطلاع على الكشوف والأرصدة والتقارير المصرح بها دون صلاحية التعديل أو المسح.',
    permissions: ['view_dashboard', 'view_balances', 'view_reports'],
  },
  {
    id: 'role-admin',
    code: 'admin',
    nameAr: 'مدير النظام',
    descriptionAr: 'إدارة المستخدمين والأدوار، الصلاحيات، إعدادات المنظومة، وسجل التدقيق الكامل.',
    permissions: ['manage_users', 'manage_settings', 'view_audit_logs', 'all'],
  },
];

export const SEED_FERTILIZER_TYPES: FertilizerType[] = [
  { id: 'fert-urea', code: 'urea', nameAr: 'يوريا', sortOrder: 1, bagWeightKg: 50, isActive: true },
  { id: 'fert-nitrate', code: 'nitrate', nameAr: 'نترات', sortOrder: 2, bagWeightKg: 50, isActive: true },
  { id: 'fert-sulfate', code: 'sulfate', nameAr: 'سلفات', sortOrder: 3, bagWeightKg: 50, isActive: true },
];

export const SEED_GOVERNORATES: Governorate[] = [
  { id: 'gov-ismailia', code: 'ISM', nameAr: 'الإسماعيلية', region: 'إقليم قناة السويس', isActive: true },
  { id: 'gov-suez', code: 'SUZ', nameAr: 'السويس', region: 'إقليم قناة السويس', isActive: true },
  { id: 'gov-portsaid', code: 'PTS', nameAr: 'بورسعيد', region: 'إقليم قناة السويس', isActive: true },
  { id: 'gov-cairo', code: 'CAI', nameAr: 'القاهرة', region: 'إقليم القاهرة الكبرى', isActive: true },
  { id: 'gov-giza', code: 'GIZ', nameAr: 'الجيزة', region: 'إقليم القاهرة الكبرى', isActive: true },
  { id: 'gov-qalyubia', code: 'QLY', nameAr: 'القليوبية', region: 'إقليم القاهرة الكبرى', isActive: true },
  { id: 'gov-alexandria', code: 'ALX', nameAr: 'الإسكندرية', region: 'إقليم الإسكندرية', isActive: true },
  { id: 'gov-beheira', code: 'BHR', nameAr: 'البحيرة', region: 'إقليم الإسكندرية', isActive: true },
  { id: 'gov-matrouh', code: 'MTR', nameAr: 'مطروح', region: 'إقليم الإسكندرية', isActive: true },
  { id: 'gov-sharkia', code: 'SHR', nameAr: 'الشرقية', region: 'إقليم قناة السويس وشرق الدلتا', isActive: true },
  { id: 'gov-dakahlia', code: 'DKH', nameAr: 'الدقهلية', region: 'إقليم الدلتا', isActive: true },
  { id: 'gov-gharbia', code: 'GHR', nameAr: 'الغربية', region: 'إقليم الدلتا', isActive: true },
  { id: 'gov-monufia', code: 'MNF', nameAr: 'المنوفية', region: 'إقليم الدلتا', isActive: true },
  { id: 'gov-kafr-el-sheikh', code: 'KFS', nameAr: 'كفر الشيخ', region: 'إقليم الدلتا', isActive: true },
  { id: 'gov-damietta', code: 'DMT', nameAr: 'دمياط', region: 'إقليم الدلتا', isActive: true },
  { id: 'gov-north-sinai', code: 'NSI', nameAr: 'شمال سيناء', region: 'إقليم قناة السويس', isActive: true },
  { id: 'gov-south-sinai', code: 'SSI', nameAr: 'جنوب سيناء', region: 'إقليم قناة السويس', isActive: true },
  { id: 'gov-faiyum', code: 'FYM', nameAr: 'الفيوم', region: 'شمال الصعيد', isActive: true },
  { id: 'gov-beni-suef', code: 'BNS', nameAr: 'بني سويف', region: 'شمال الصعيد', isActive: true },
  { id: 'gov-minya', code: 'MNY', nameAr: 'المنيا', region: 'شمال الصعيد', isActive: true },
  { id: 'gov-assiut', code: 'AST', nameAr: 'أسيوط', region: 'وسط الصعيد', isActive: true },
  { id: 'gov-new-valley', code: 'WAD', nameAr: 'الوادي الجديد', region: 'وسط الصعيد', isActive: true },
  { id: 'gov-sohag', code: 'SHG', nameAr: 'سوهاج', region: 'جنوب الصعيد', isActive: true },
  { id: 'gov-qena', code: 'QNA', nameAr: 'قنا', region: 'جنوب الصعيد', isActive: true },
  { id: 'gov-luxor', code: 'LXR', nameAr: 'الأقصر', region: 'جنوب الصعيد', isActive: true },
  { id: 'gov-aswan', code: 'ASW', nameAr: 'أسوان', region: 'جنوب الصعيد', isActive: true },
  { id: 'gov-red-sea', code: 'RSD', nameAr: 'البحر الأحمر', region: 'جنوب الصعيد', isActive: true },
];

export const SEED_CENTERS: GovernorateCenter[] = [
  // Ismailia Central Distribution Points (21 points from official DST distribution schedule)
  { id: 'ctr-ism-abdrabbo', governorateId: 'gov-ismailia', code: 'ISM-P01', nameAr: 'نقطة توزيع عبدربه حماده 1', isActive: true },
  { id: 'ctr-ism-rawda', governorateId: 'gov-ismailia', code: 'ISM-P02', nameAr: 'نقطة توزيع الروضة', isActive: true },
  { id: 'ctr-ism-zeraieen', governorateId: 'gov-ismailia', code: 'ISM-P03', nameAr: 'نقطة توزيع الزراعيين', isActive: true },
  { id: 'ctr-ism-talkebir-eslah', governorateId: 'gov-ismailia', code: 'ISM-P04', nameAr: 'نقطة توزيع التل الكبير إصلاح', isActive: true },
  { id: 'ctr-ism-qassasin-old', governorateId: 'gov-ismailia', code: 'ISM-P05', nameAr: 'نقطة توزيع القصاصين القديمة', isActive: true },
  { id: 'ctr-ism-rayah', governorateId: 'gov-ismailia', code: 'ISM-P06', nameAr: 'نقطة توزيع الرياح', isActive: true },
  { id: 'ctr-ism-taqadom', governorateId: 'gov-ismailia', code: 'ISM-P07', nameAr: 'نقطة توزيع التقدم', isActive: true },
  { id: 'ctr-ism-qassasin-new', governorateId: 'gov-ismailia', code: 'ISM-P08', nameAr: 'نقطة توزيع القصاصين الجديدة', isActive: true },
  { id: 'ctr-ism-engineers', governorateId: 'gov-ismailia', code: 'ISM-P09', nameAr: 'نقطة توزيع المهندسون الزراعيون بالقليوبية', isActive: true },
  { id: 'ctr-ism-makka', governorateId: 'gov-ismailia', code: 'ISM-P10', nameAr: 'نقطة توزيع مكة', isActive: true },
  { id: 'ctr-ism-abusweir', governorateId: 'gov-ismailia', code: 'ISM-P11', nameAr: 'نقطة توزيع أبو صوير المحطة', isActive: true },
  { id: 'ctr-ism-dabiya', governorateId: 'gov-ismailia', code: 'ISM-P12', nameAr: 'نقطة توزيع الضبعية', isActive: true },
  { id: 'ctr-ism-fanara', governorateId: 'gov-ismailia', code: 'ISM-P13', nameAr: 'نقطة توزيع فنارة', isActive: true },
  { id: 'ctr-ism-manayef', governorateId: 'gov-ismailia', code: 'ISM-P14', nameAr: 'نقطة توزيع المنايف الغربية', isActive: true },
  { id: 'ctr-ism-sarabium', governorateId: 'gov-ismailia', code: 'ISM-P15', nameAr: 'نقطة توزيع سرابيوم الهاويس', isActive: true },
  { id: 'ctr-ism-bayadiya', governorateId: 'gov-ismailia', code: 'ISM-P16', nameAr: 'نقطة توزيع البياضية', isActive: true },
  { id: 'ctr-ism-tameer', governorateId: 'gov-ismailia', code: 'ISM-P17', nameAr: 'نقطة توزيع تعمير الصحاري', isActive: true },
  { id: 'ctr-ism-sinai', governorateId: 'gov-ismailia', code: 'ISM-P18', nameAr: 'نقطة توزيع سيناء', isActive: true },
  { id: 'ctr-ism-10ramadan', governorateId: 'gov-ismailia', code: 'ISM-P19', nameAr: 'نقطة توزيع العاشر من رمضان', isActive: true },
  { id: 'ctr-ism-elmeya', governorateId: 'gov-ismailia', code: 'ISM-P20', nameAr: 'نقطة توزيع العلمية', isActive: true },
  { id: 'ctr-ism-wadimalak', governorateId: 'gov-ismailia', code: 'ISM-P21', nameAr: 'نقطة توزيع وادي الملاك', isActive: true },

  // Suez Distribution Points
  { id: 'ctr-suz-central', governorateId: 'gov-suez', code: 'SUZ-P01', nameAr: 'نقاط توزيع محافظة السويس', isActive: true },

  // Port Said Central Distribution Points (11 points from official DST map)
  { id: 'ctr-ps-amal', governorateId: 'gov-portsaid', code: 'PTS-P01', nameAr: 'نقطة توزيع أمل بورسعيد', isActive: true },
  { id: 'ctr-ps-ibnyasser', governorateId: 'gov-portsaid', code: 'PTS-P02', nameAr: 'نقطة توزيع ابن ياسر', isActive: true },
  { id: 'ctr-ps-zohour', governorateId: 'gov-portsaid', code: 'PTS-P03', nameAr: 'نقطة توزيع الزهور', isActive: true },
  { id: 'ctr-ps-23dec', governorateId: 'gov-portsaid', code: 'PTS-P04', nameAr: 'نقطة توزيع 23 ديسمبر', isActive: true },
  { id: 'ctr-ps-bahry-nasser', governorateId: 'gov-portsaid', code: 'PTS-P05', nameAr: 'نقطة توزيع بحري ناصر', isActive: true },
  { id: 'ctr-ps-qebly-nasser', governorateId: 'gov-portsaid', code: 'PTS-P06', nameAr: 'نقطة توزيع قبلي ناصر', isActive: true },
  { id: 'ctr-ps-tanis', governorateId: 'gov-portsaid', code: 'PTS-P07', nameAr: 'نقطة توزيع تانيس', isActive: true },
  { id: 'ctr-ps-ababda', governorateId: 'gov-portsaid', code: 'PTS-P08', nameAr: 'نقطة توزيع العبابدة', isActive: true },
  { id: 'ctr-ps-tahya-misr', governorateId: 'gov-portsaid', code: 'PTS-P09', nameAr: 'نقطة توزيع تحيا مصر', isActive: true },
  { id: 'ctr-ps-village7', governorateId: 'gov-portsaid', code: 'PTS-P10', nameAr: 'نقطة توزيع القرية السابعة', isActive: true },
  { id: 'ctr-ps-ekhlas', governorateId: 'gov-portsaid', code: 'PTS-P11', nameAr: 'نقطة توزيع الإخلاص', isActive: true },

  // Default distribution centers for the remaining 24 Egyptian governorates
  { id: 'ctr-cai-main', governorateId: 'gov-cairo', code: 'CAI-P01', nameAr: 'نقطة التوزيع الرئيسية - القاهرة', isActive: true },
  { id: 'ctr-giz-main', governorateId: 'gov-giza', code: 'GIZ-P01', nameAr: 'نقطة التوزيع الرئيسية - الجيزة', isActive: true },
  { id: 'ctr-qly-main', governorateId: 'gov-qalyubia', code: 'QLY-P01', nameAr: 'نقطة التوزيع الرئيسية - القليوبية', isActive: true },
  { id: 'ctr-alx-main', governorateId: 'gov-alexandria', code: 'ALX-P01', nameAr: 'نقطة التوزيع الرئيسية - الإسكندرية', isActive: true },
  { id: 'ctr-bhr-main', governorateId: 'gov-beheira', code: 'BHR-P01', nameAr: 'نقطة التوزيع الرئيسية - البحيرة', isActive: true },
  { id: 'ctr-mtr-main', governorateId: 'gov-matrouh', code: 'MTR-P01', nameAr: 'نقطة التوزيع الرئيسية - مطروح', isActive: true },
  { id: 'ctr-shr-main', governorateId: 'gov-sharkia', code: 'SHR-P01', nameAr: 'نقطة التوزيع الرئيسية - الشرقية', isActive: true },
  { id: 'ctr-dkh-main', governorateId: 'gov-dakahlia', code: 'DKH-P01', nameAr: 'نقطة التوزيع الرئيسية - الدقهلية', isActive: true },
  { id: 'ctr-ghr-main', governorateId: 'gov-gharbia', code: 'GHR-P01', nameAr: 'نقطة التوزيع الرئيسية - الغربية', isActive: true },
  { id: 'ctr-mnf-main', governorateId: 'gov-monufia', code: 'MNF-P01', nameAr: 'نقطة التوزيع الرئيسية - المنوفية', isActive: true },
  { id: 'ctr-kfs-main', governorateId: 'gov-kafr-el-sheikh', code: 'KFS-P01', nameAr: 'نقطة التوزيع الرئيسية - كفر الشيخ', isActive: true },
  { id: 'ctr-dmt-main', governorateId: 'gov-damietta', code: 'DMT-P01', nameAr: 'نقطة التوزيع الرئيسية - دمياط', isActive: true },
  { id: 'ctr-nsi-main', governorateId: 'gov-north-sinai', code: 'NSI-P01', nameAr: 'نقطة التوزيع الرئيسية - شمال سيناء', isActive: true },
  { id: 'ctr-ssi-main', governorateId: 'gov-south-sinai', code: 'SSI-P01', nameAr: 'نقطة التوزيع الرئيسية - جنوب سيناء', isActive: true },
  { id: 'ctr-fym-main', governorateId: 'gov-faiyum', code: 'FYM-P01', nameAr: 'نقطة التوزيع الرئيسية - الفيوم', isActive: true },
  { id: 'ctr-bns-main', governorateId: 'gov-beni-suef', code: 'BNS-P01', nameAr: 'نقطة التوزيع الرئيسية - بني سويف', isActive: true },
  { id: 'ctr-mny-main', governorateId: 'gov-minya', code: 'MNY-P01', nameAr: 'نقطة التوزيع الرئيسية - المنيا', isActive: true },
  { id: 'ctr-ast-main', governorateId: 'gov-assiut', code: 'AST-P01', nameAr: 'نقطة التوزيع الرئيسية - أسيوط', isActive: true },
  { id: 'ctr-wad-main', governorateId: 'gov-new-valley', code: 'WAD-P01', nameAr: 'نقطة التوزيع الرئيسية - الوادي الجديد', isActive: true },
  { id: 'ctr-shg-main', governorateId: 'gov-sohag', code: 'SHG-P01', nameAr: 'نقطة التوزيع الرئيسية - سوهاج', isActive: true },
  { id: 'ctr-qna-main', governorateId: 'gov-qena', code: 'QNA-P01', nameAr: 'نقطة التوزيع الرئيسية - قنا', isActive: true },
  { id: 'ctr-lxr-main', governorateId: 'gov-luxor', code: 'LXR-P01', nameAr: 'نقطة التوزيع الرئيسية - الأقصر', isActive: true },
  { id: 'ctr-asw-main', governorateId: 'gov-aswan', code: 'ASW-P01', nameAr: 'نقطة التوزيع الرئيسية - أسوان', isActive: true },
  { id: 'ctr-rsd-main', governorateId: 'gov-red-sea', code: 'RSD-P01', nameAr: 'نقطة التوزيع الرئيسية - البحر الأحمر', isActive: true },
];

export const SEED_VILLAGES: CenterVillage[] = [
  { id: 'vil-ism-dabiya', governorateId: 'gov-ismailia', centerId: 'ctr-ism-dabiya', nameAr: 'قرية الضبعية', isActive: true },
  { id: 'vil-ism-nefeisha', governorateId: 'gov-ismailia', centerId: 'ctr-ism-dabiya', nameAr: 'قرية نفيشة', isActive: true },
  { id: 'vil-ism-fanara', governorateId: 'gov-ismailia', centerId: 'ctr-ism-fanara', nameAr: 'قرية فنارة', isActive: true },
  { id: 'vil-ism-sarabium', governorateId: 'gov-ismailia', centerId: 'ctr-ism-sarabium', nameAr: 'قرية سرابيوم', isActive: true },
  { id: 'vil-suz-ganayen', governorateId: 'gov-suez', centerId: 'ctr-suz-central', nameAr: 'حي الجناين والقطاع الريفي', isActive: true },
  { id: 'vil-ps-sahl', governorateId: 'gov-portsaid', centerId: 'ctr-ps-tahya-misr', nameAr: 'قطاع سهل الطينة', isActive: true },
  { id: 'vil-ps-ganoub', governorateId: 'gov-portsaid', centerId: 'ctr-ps-ekhlas', nameAr: 'جنوب بورسعيد', isActive: true },
];

interface RawAssocSeed {
  id: string;
  code: string;
  nameAr: string;
  governorateId: string;
  centerId: string;
  villageId?: string;
  supervisionType?: string;
  distributionDay?: string;
  capacity?: number;
}

const ismailiaSpecs: Array<[string, string, string, string]> = [
  // [centerId, nameAr, supervisionType, distributionDay]
  // 1. عبدربه حماده 1
  ['ctr-ism-abdrabbo', 'أرض الفيروز', 'استصلاح', 'السبت'],
  ['ctr-ism-abdrabbo', 'عبدربه حماده 1', 'استصلاح', 'الأحد'],
  ['ctr-ism-abdrabbo', 'صلاح سليم', 'استصلاح', 'الإثنين'],
  ['ctr-ism-abdrabbo', 'عبدربه حماده 2', 'استصلاح', 'الثلاثاء'],
  ['ctr-ism-abdrabbo', 'الحاوي والمغربي', 'استصلاح', 'الأربعاء'],
  ['ctr-ism-abdrabbo', 'مدين', 'استصلاح', 'الخميس'],
  ['ctr-ism-abdrabbo', 'قاسم + عباد الرحمن', 'استصلاح', 'الخميس'],
  // 2. الروضة
  ['ctr-ism-rawda', 'الروضة', 'ائتمان', 'السبت'],
  ['ctr-ism-rawda', 'أبوطفيلة', 'ائتمان', 'الأحد'],
  ['ctr-ism-rawda', 'النصر', 'ائتمان', 'الإثنين'],
  ['ctr-ism-rawda', 'الرياض', 'ائتمان', 'الثلاثاء'],
  ['ctr-ism-rawda', 'الفردان', 'ائتمان', 'الأربعاء'],
  ['ctr-ism-rawda', 'البلاح', 'ائتمان', 'الخميس'],
  // 3. الزراعيين
  ['ctr-ism-zeraieen', 'التوفيق', 'استصلاح', 'السبت'],
  ['ctr-ism-zeraieen', 'الزراعيين', 'استصلاح', 'الأحد+الإثنين'],
  ['ctr-ism-zeraieen', 'شباب 1', 'استصلاح', 'الثلاثاء'],
  ['ctr-ism-zeraieen', 'الكمال', 'استصلاح', 'الأربعاء'],
  ['ctr-ism-zeraieen', 'أمون', 'استصلاح', 'الخميس'],
  // 4. التل الكبير إصلاح
  ['ctr-ism-talkebir-eslah', 'التل الكبير إصلاح', 'إصلاح', 'الأحد'],
  ['ctr-ism-talkebir-eslah', 'الظاهرية', 'إصلاح', 'الإثنين'],
  ['ctr-ism-talkebir-eslah', 'البعالوة الكبرى', 'إصلاح', 'الثلاثاء'],
  ['ctr-ism-talkebir-eslah', 'البعالوة الصغرى', 'إصلاح', 'الأربعاء'],
  ['ctr-ism-talkebir-eslah', 'أبوعاشور', 'إصلاح', 'الخميس'],
  // 5. القصاصين القديمة
  ['ctr-ism-qassasin-old', 'القصاصين', 'إصلاح', 'السبت'],
  ['ctr-ism-qassasin-old', 'منشأة القصاصين', 'إصلاح', 'الأحد'],
  ['ctr-ism-qassasin-old', 'التل الكبير إئتمان', 'ائتمان', 'الإثنين+الثلاثاء'],
  ['ctr-ism-qassasin-old', 'القصاصين القديمة', 'ائتمان', 'الأربعاء+الخميس'],
  // 6. الرياح
  ['ctr-ism-rayah', 'البحيرة', 'ائتمان', 'السبت+الأحد+الإثنين'],
  ['ctr-ism-rayah', 'الرياح', 'ائتمان', 'الثلاثاء+الأربعاء+الخميس'],
  // 7. التقدم
  ['ctr-ism-taqadom', 'الأمل', 'استصلاح', 'الأحد+الإثنين'],
  ['ctr-ism-taqadom', 'جامعة قناة السويس', 'استصلاح', 'الثلاثاء'],
  ['ctr-ism-taqadom', 'التقدم', 'استصلاح', 'الأربعاء'],
  ['ctr-ism-taqadom', 'الإسماعيلية الجديدة', 'استصلاح', 'الخميس'],
  // 8. القصاصين الجديدة
  ['ctr-ism-qassasin-new', 'القصاصين الجديدة', 'ائتمان', 'السبت+الأحد'],
  ['ctr-ism-qassasin-new', 'رواد المحسمة', 'ائتمان', 'الإثنين+الثلاثاء'],
  ['ctr-ism-qassasin-new', 'المحسمة القديمة', 'ائتمان', 'الأربعاء+الخميس'],
  // 9. المهندسون الزراعيون بالقليوبية
  ['ctr-ism-engineers', 'العمار', 'استصلاح', 'الأحد+الإثنين'],
  ['ctr-ism-engineers', 'المهندسون الزراعيون بالقليوبية', 'استصلاح', 'الثلاثاء'],
  ['ctr-ism-engineers', 'شباب 2', 'استصلاح', 'الأربعاء'],
  ['ctr-ism-engineers', 'شباب 3', 'استصلاح', 'الخميس'],
  // 10. مكة
  ['ctr-ism-makka', 'علي بن أبي طالب', 'استصلاح', 'السبت'],
  ['ctr-ism-makka', 'السرور', 'استصلاح', 'الأحد+الإثنين'],
  ['ctr-ism-makka', 'مكة', 'استصلاح', 'الثلاثاء+الأربعاء'],
  ['ctr-ism-makka', 'بدر', 'استصلاح', 'الخميس'],
  // 11. أبو صوير المحطة
  ['ctr-ism-abusweir', 'الواصفية', 'ائتمان', 'الأحد'],
  ['ctr-ism-abusweir', 'أبوصوير المحطة', 'ائتمان', 'الإثنين'],
  ['ctr-ism-abusweir', 'أبوجريش', 'ائتمان', 'الثلاثاء'],
  ['ctr-ism-abusweir', 'أبوصوير الجديدة', 'ائتمان', 'الأربعاء'],
  ['ctr-ism-abusweir', 'أبوصوير البلد', 'ائتمان', 'الخميس'],
  // 12. الضبعية
  ['ctr-ism-dabiya', 'عين غصين', 'ائتمان', 'الأحد'],
  ['ctr-ism-dabiya', 'نفيشة', 'ائتمان', 'الإثنين'],
  ['ctr-ism-dabiya', 'طوسون', 'ائتمان', 'الثلاثاء'],
  ['ctr-ism-dabiya', 'الضبعية', 'ائتمان', 'الأربعاء'],
  ['ctr-ism-dabiya', 'أبوشحاتة', 'ائتمان', 'الخميس'],
  // 13. فنارة
  ['ctr-ism-fanara', 'كسفريت', 'ائتمان', 'السبت+الأحد'],
  ['ctr-ism-fanara', 'فايد', 'ائتمان', 'الإثنين+الثلاثاء'],
  ['ctr-ism-fanara', 'فنارة', 'ائتمان', 'الأربعاء+الخميس'],
  // 14. المنايف الغربية
  ['ctr-ism-manayef', 'المنايف الشرقية', 'ائتمان', 'السبت'],
  ['ctr-ism-manayef', 'المنايف الغربية', 'ائتمان', 'الأحد+الإثنين'],
  ['ctr-ism-manayef', 'السبع آبار الشرقية', 'ائتمان', 'الثلاثاء'],
  ['ctr-ism-manayef', 'السبع آبار الغربية', 'ائتمان', 'الأربعاء'],
  ['ctr-ism-manayef', 'المحسمة الجديدة', 'ائتمان', 'الخميس'],
  // 15. سرابيوم الهاويس
  ['ctr-ism-sarabium', 'أبو سلطان', 'ائتمان', 'الأحد'],
  ['ctr-ism-sarabium', 'سرابيوم المحطة', 'ائتمان', 'الإثنين'],
  ['ctr-ism-sarabium', 'سرابيوم الهاويس', 'ائتمان', 'الثلاثاء'],
  ['ctr-ism-sarabium', 'السعدية', 'ائتمان', 'الأربعاء'],
  // 16. البياضية
  ['ctr-ism-bayadiya', 'القنطرة غرب', 'ائتمان', 'السبت+الأحد+الإثنين'],
  ['ctr-ism-bayadiya', 'البياضية', 'ائتمان', 'الثلاثاء+الأربعاء+الخميس'],
  // 17. تعمير الصحاري
  ['ctr-ism-tameer', 'الإسماعيلية للتعمير', 'استصلاح', 'السبت+الأحد'],
  ['ctr-ism-tameer', 'السلام', 'استصلاح', 'الإثنين+الثلاثاء'],
  ['ctr-ism-tameer', 'تعمير الصحاري', 'استصلاح', 'الأربعاء+الخميس'],
  // 18. سيناء
  ['ctr-ism-sinai', 'شرق البحيرات', 'استصلاح', 'السبت+الأحد'],
  ['ctr-ism-sinai', 'شباب شرق البحيرات', 'استصلاح', 'الإثنين+الثلاثاء'],
  ['ctr-ism-sinai', 'سيناء', 'استصلاح', 'الأربعاء+الخميس'],
  // 19. العاشر من رمضان
  ['ctr-ism-10ramadan', 'الصحابة', 'استصلاح', 'السبت+الأحد+الإثنين'],
  ['ctr-ism-10ramadan', 'العاشر من رمضان', 'استصلاح', 'الثلاثاء+الأربعاء+الخميس'],
  // 20. العلمية
  ['ctr-ism-elmeya', 'العبور', 'استصلاح', 'السبت+الأحد'],
  ['ctr-ism-elmeya', 'الإصلاح', 'استصلاح', 'الإثنين+الثلاثاء'],
  ['ctr-ism-elmeya', 'العلمية', 'استصلاح', 'الأربعاء+الخميس'],
  // 21. وادي الملاك
  ['ctr-ism-wadimalak', 'وادي الملاك', 'ائتمان', 'الأحد:الخميس'],
];

const suezNames: string[] = [
  'العمدة (الجناين)',
  'محمد كريم',
  'كبريت',
  'شندورة',
  'الشط',
  'قرية عامر',
  'الشلوفة',
  'جنيفة',
  'الرائد',
  'الزراعيين',
  'يوسف السباعي',
  'محمد عبده',
  'الشباب الوطني',
  'رابطة الصحفيين',
];

const portSaidSpecs: Array<[string, string, string, number]> = [
  // [centerId, nameAr, supervisionType, capacity]
  // 1. أمل بورسعيد
  ['ctr-ps-amal', 'الخلفاء الراشدين', 'استصلاح', 150],
  ['ctr-ps-amal', 'العبور', 'استصلاح', 50],
  ['ctr-ps-amal', 'الأسراء', 'استصلاح', 100],
  ['ctr-ps-amal', 'أمل بورسعيد', 'استصلاح', 200],
  ['ctr-ps-amal', 'النماء', 'استصلاح', 50],
  ['ctr-ps-amal', 'النورس', 'شباب خريجين (استصلاح)', 150],
  // 2. ابن ياسر
  ['ctr-ps-ibnyasser', 'بن ياسر', 'استصلاح', 100],
  ['ctr-ps-ibnyasser', 'العاشر من رمضان', 'استصلاح', 50],
  ['ctr-ps-ibnyasser', 'بور فؤاد', 'استصلاح', 50],
  ['ctr-ps-ibnyasser', 'خالد بن الوليد', 'استصلاح', 100],
  // 3. الزهور
  ['ctr-ps-zohour', 'السلام استصلاح', 'استصلاح', 100],
  ['ctr-ps-zohour', 'الزهور', 'استصلاح', 200],
  ['ctr-ps-zohour', 'القناة', 'استصلاح', 50],
  ['ctr-ps-zohour', 'الاتحاد', 'استصلاح', 100],
  ['ctr-ps-zohour', 'النصر', 'استصلاح', 50],
  // 4. 23 ديسمبر
  ['ctr-ps-23dec', 'محاربي 6 أكتوبر', 'استصلاح', 100],
  ['ctr-ps-23dec', '23 ديسمبر', 'استصلاح', 100],
  ['ctr-ps-23dec', 'المستقبل', 'استصلاح', 50],
  ['ctr-ps-23dec', 'الكاب', 'استصلاح', 50],
  ['ctr-ps-23dec', 'بورسعيد', 'استصلاح', 100],
  // 5. بحري ناصر
  ['ctr-ps-bahry-nasser', 'الجنوب الأخضر', 'استصلاح', 50],
  ['ctr-ps-bahry-nasser', 'عمار', 'استصلاح', 100],
  ['ctr-ps-bahry-nasser', 'عمر بن الخطاب', 'استصلاح', 200],
  ['ctr-ps-bahry-nasser', 'بدر', 'استصلاح', 50],
  ['ctr-ps-bahry-nasser', 'الفتح', 'استصلاح', 50],
  ['ctr-ps-bahry-nasser', 'بحري ناصر', 'استصلاح', 200],
  // 6. قبلي ناصر
  ['ctr-ps-qebly-nasser', 'قبلي ناصر', 'شباب خريجين (استصلاح)', 100],
  ['ctr-ps-qebly-nasser', 'الخير', 'ائتمان', 75],
  ['ctr-ps-qebly-nasser', 'سهل التينة', 'استصلاح', 50],
  // 7. تانيس
  ['ctr-ps-tanis', 'الجليل', 'شباب خريجين (استصلاح)', 100],
  ['ctr-ps-tanis', 'تانيس', 'شباب خريجين (استصلاح)', 150],
  ['ctr-ps-tanis', 'القدس', 'شباب خريجين (استصلاح)', 100],
  ['ctr-ps-tanis', 'ابن سينا', 'شباب خريجين (استصلاح)', 50],
  ['ctr-ps-tanis', 'نور الإسلام', 'شباب خريجين (استصلاح)', 50],
  // 8. العبابدة
  ['ctr-ps-ababda', 'أم خلف القبلية', 'استصلاح', 50],
  ['ctr-ps-ababda', 'العبابدة', 'استصلاح', 100],
  ['ctr-ps-ababda', 'عمرو بن العاص', 'شباب خريجين (استصلاح)', 50],
  ['ctr-ps-ababda', 'أم خلف البحرية', 'استصلاح', 100],
  // 9. تحيا مصر
  ['ctr-ps-tahya-misr', 'أحمد منسي', 'قطاع سهل الطينة (استصلاح)', 100],
  ['ctr-ps-tahya-misr', 'تحيا مصر', 'قطاع سهل الطينة (استصلاح)', 300],
  ['ctr-ps-tahya-misr', 'سهل الخير', 'قطاع سهل الطينة (استصلاح)', 50],
  ['ctr-ps-tahya-misr', 'الشهيد إسلام', 'قطاع سهل الطينة (استصلاح)', 150],
  ['ctr-ps-tahya-misr', 'المستشار زكريا', 'قطاع سهل الطينة (استصلاح)', 50],
  ['ctr-ps-tahya-misr', 'الوحدة المشتركة', 'قطاع سهل الطينة (استصلاح)', 300],
  // 10. القرية السابعة
  ['ctr-ps-village7', 'الشهيد عطا', 'قطاع سهل الطينة (استصلاح)', 100],
  ['ctr-ps-village7', 'القرية السابعة', 'قطاع سهل الطينة (استصلاح)', 300],
  ['ctr-ps-village7', 'سلام مصر', 'قطاع سهل الطينة (استصلاح)', 100],
  ['ctr-ps-village7', 'القرية الرابعة', 'قطاع سهل الطينة (استصلاح)', 300],
  // 11. الإخلاص
  ['ctr-ps-ekhlas', 'بحر البقر', 'ائتمان', 50],
  ['ctr-ps-ekhlas', 'السلام ائتمان', 'ائتمان', 50],
  ['ctr-ps-ekhlas', 'الإخلاص', 'ائتمان', 75],
];

const rawAssociations: RawAssocSeed[] = [
  ...ismailiaSpecs.map(([centerId, nameAr, supervisionType, distributionDay], idx) => ({
    id: `assoc-ism-${String(idx + 1).padStart(3, '0')}`,
    code: `ISM-${String(idx + 1).padStart(3, '0')}`,
    nameAr,
    governorateId: 'gov-ismailia',
    centerId,
    supervisionType,
    distributionDay,
  })),
  ...suezNames.map((nameAr, idx) => ({
    id: `assoc-suz-${String(idx + 1).padStart(3, '0')}`,
    code: `SUZ-${String(idx + 1).padStart(3, '0')}`,
    nameAr,
    governorateId: 'gov-suez',
    centerId: 'ctr-suz-central',
    villageId: 'vil-suz-ganayen',
  })),
  ...portSaidSpecs.map(([centerId, nameAr, supervisionType, capacity], idx) => ({
    id: `assoc-ps-${String(idx + 1).padStart(3, '0')}`,
    code: `PTS-${String(idx + 1).padStart(3, '0')}`,
    nameAr,
    governorateId: 'gov-portsaid',
    centerId,
    supervisionType,
    capacity,
  })),
];

export const SEED_ASSOCIATIONS: AgriculturalAssociation[] = rawAssociations.map((item) => ({
  id: item.id,
  code: item.code,
  nameAr: item.nameAr,
  normalizedName: normalizeArabicName(item.nameAr),
  governorateId: item.governorateId,
  centerId: item.centerId,
  ...(item.villageId ? { villageId: item.villageId } : {}),
  managerName: '',
  managerPhone: '',
  ...(item.supervisionType ? { supervisionType: item.supervisionType } : {}),
  ...(item.distributionDay ? { distributionDay: item.distributionDay } : {}),
  ...(typeof item.capacity === 'number' ? { capacity: item.capacity } : {}),
  isActive: true,
}));

export function getTodayDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createSeedReportsAndDisbursements(_today = getTodayDateIso()): {
  reports: DailyReport[];
  disbursements: DailyDisbursementRow[];
} {
  // No fabricated daily records or placeholder zeros are seeded automatically;
  // days without manual/OCR submissions remain unrecorded (null) until saved by staff.
  return { reports: [], disbursements: [] };
}

export function createSeedTractors(_today = getTodayDateIso()): TractorDelivery[] {
  return [];
}

export function createSeedApprovals(_today = getTodayDateIso()): ApprovalRecord[] {
  return [];
}

export function createSeedIntegrationLogs(_today = getTodayDateIso()): IntegrationLogEntry[] {
  return [];
}

export function createSeedAuditLogs(today = getTodayDateIso()): AuditLogEntry[] {
  return [
    {
      id: 'aud-init-zero',
      actorUid: 'system-seed',
      actorEmail: 'system@dst-agri.eg',
      actorName: 'تهيئة المنظومة',
      actorRole: 'admin',
      action: 'SYSTEM_INIT_27_GOVS',
      entityType: 'agricultural_associations',
      entityId: 'all',
      details: `تهيئة 27 محافظة و${SEED_ASSOCIATIONS.length} جمعية زراعية معتمدة دون أرصدة مصطنعة`,
      createdAt: `${today}T00:00:00.000Z`,
    },
  ];
}

export const SEED_IMAGE_ATTACHMENTS: ImageAttachmentRecord[] = [];

export const SEED_SYSTEM_SETTINGS: SystemSettings = {
  id: 'global',
  requireDriverNationalId: true,
  centralApiUrl: '',
  autoSyncOnApproval: false,
  organizationNameAr: 'منظومة DST للرقابة الزراعية وتوزيع الأسمدة',
  treatEmptyAsZero: false,
  minThresholds: {
    urea: null,
    nitrate: null,
    sulfate: null,
  },
  assocMinThresholds: {},
};
