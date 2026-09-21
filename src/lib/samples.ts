import type { SourceLang } from './lang/codes.ts';

export interface Sample {
  /**
   * 60–100 words (Thai ≈ 250 chars) with placeholders <1>…</1> and <2/> — the popup's
   * default text and the bench's `single` request.
   */
  paragraph: string;
  /**
   * Three sentences of the same language for the bench's profile-B `batch3` request
   * (spec §5.4: first batch ≤ 3).
   */
  sentences: [string, string, string];
}

/**
 * Fixed texts shared by the popup and the bench so their numbers are comparable.
 * Neutral technical/financial content.
 */
export const SAMPLES: Record<SourceLang, Sample> = {
  en: {
    paragraph:
      'Quarterly revenue rose 12% to $4.8 billion, driven by <1>subscription services</1> and a smaller contribution from hardware.<2/> Operating margin expanded to 31.5% as the company cut logistics costs and renegotiated supplier contracts. Management raised full-year guidance but warned that currency headwinds could trim reported growth by two to three points in the fourth quarter. Analysts at three banks kept their buy ratings, citing the recurring nature of the revenue base and a net cash position of $9.1 billion.',
    sentences: [
      'The API returns a paginated list of orders, and each page includes a cursor for fetching the next batch.',
      'Set the <1>timeout</1> to 30 seconds so that slow upstream services do not block the worker pool.',
      'Refunds are processed within five business days, and the fee of 2.9% is not returned to the merchant.',
    ],
  },
  ru: {
    paragraph:
      'Выручка за квартал выросла на 12% до 4,8 млрд рублей благодаря <1>подписочным сервисам</1> и небольшому вкладу продаж оборудования.<2/> Операционная маржа увеличилась до 31,5%, поскольку компания сократила логистические расходы и пересмотрела контракты с поставщиками. Руководство повысило прогноз на год, но предупредило, что колебания курса могут снизить отчётный рост на два–три пункта в четвёртом квартале. Аналитики трёх банков сохранили рекомендацию «покупать», отметив регулярный характер выручки и чистую денежную позицию в 9,1 млрд рублей.',
    sentences: [
      'Продавец обязан загрузить сертификат соответствия в личный кабинет до начала продаж товара на площадке.',
      'Налоговая декларация подаётся не позднее <1>25 апреля</1>, а уплата налога производится до 28 числа того же месяца.',
      'Комиссия маркетплейса составляет 15% от стоимости заказа и удерживается при перечислении выплаты продавцу.',
    ],
  },
  'zh-Hans': {
    paragraph:
      '本季度营收同比增长12%，达到48亿元，主要得益于<1>订阅服务</1>的增长，硬件销售的贡献较小。<2/>由于公司削减了物流成本并重新谈判了供应商合同，营业利润率扩大至31.5%。管理层上调了全年业绩指引，但警告称汇率波动可能使第四季度的报告增速下降两到三个百分点。三家银行的分析师维持买入评级，理由是收入基础具有经常性，且净现金头寸达91亿元。',
    sentences: [
      '该接口返回分页的订单列表，每一页都包含用于获取下一批数据的游标。',
      '请将<1>超时时间</1>设置为30秒，以免上游服务响应缓慢时阻塞整个工作线程池。',
      '退款将在五个工作日内处理完成，2.9%的手续费不会退还给商户。',
    ],
  },
  'zh-Hant': {
    paragraph:
      '本季營收年增12%，達到48億元，主要受惠於<1>訂閱服務</1>的成長，硬體銷售的貢獻較小。<2/>由於公司削減物流成本並重新協商供應商合約，營業利益率擴大至31.5%。管理層上調全年財測，但警告匯率波動可能使第四季的帳面成長率下降兩到三個百分點。三家銀行的分析師維持買進評等，理由是營收基礎具經常性，且淨現金部位達91億元。',
    sentences: [
      '該介面回傳分頁的訂單清單，每一頁都包含用於取得下一批資料的游標。',
      '請將<1>逾時時間</1>設定為30秒，以免上游服務回應緩慢時阻塞整個工作執行緒池。',
      '退款將於五個工作天內處理完成，2.9%的手續費不會退還給商家。',
    ],
  },
  th: {
    paragraph:
      'รายได้ประจำไตรมาสเพิ่มขึ้น 12% เป็น 4.8 พันล้านบาท โดยได้แรงหนุนจาก<1>บริการสมาชิกรายเดือน</1> และการขายฮาร์ดแวร์ที่มีสัดส่วนน้อยกว่า<2/> อัตรากำไรจากการดำเนินงานขยายตัวเป็น 31.5% หลังบริษัทลดต้นทุนโลจิสติกส์และเจรจาสัญญากับซัพพลายเออร์ใหม่ ฝ่ายบริหารปรับเพิ่มเป้าหมายทั้งปี แต่เตือนว่าความผันผวนของค่าเงินอาจทำให้อัตราการเติบโตที่รายงานในไตรมาสที่สี่ลดลงสองถึงสามจุด นักวิเคราะห์จากสามธนาคารยังคงคำแนะนำซื้อ โดยอ้างถึงรายได้ที่เกิดขึ้นประจำและฐานะเงินสดสุทธิ 9.1 พันล้านบาท',
    sentences: [
      'ผู้ขายต้องอัปโหลดใบรับรองมาตรฐานสินค้าเข้าสู่ระบบก่อนเริ่มจำหน่ายสินค้าบนแพลตฟอร์ม',
      'ตั้งค่า<1>เวลาหมดอายุ</1>ไว้ที่ 30 วินาที เพื่อไม่ให้บริการต้นทางที่ตอบสนองช้าปิดกั้นกลุ่มเวิร์กเกอร์ทั้งหมด',
      'การคืนเงินจะดำเนินการภายในห้าวันทำการ และค่าธรรมเนียม 2.9% จะไม่คืนให้กับร้านค้า',
    ],
  },
};
