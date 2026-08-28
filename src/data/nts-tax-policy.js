import {
  employmentTaxAtTenMillion2024,
  employmentTaxTable2024
} from "./employment-tax-table-2024.js";

export const NTS_SOURCE_URLS = {
  employment: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7862&mi=6583",
  employmentTable: "https://www.law.go.kr/lsBylInfoPLinkR.do?bylBrNo=00&bylCls=BE&bylNo=0002&lsNm=%EC%86%8C%EB%93%9D%EC%84%B8%EB%B2%95+%EC%8B%9C%ED%96%89%EB%A0%B9",
  business: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7902&mi=6622",
  other: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7893&mi=2227",
  withholdingOverview: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7701&mi=2289"
};

export const ntsTaxPolicy2024 = {
  id: "NTS-2024-02-29",
  version: "NTS-2024-02-29",
  name: "국세청 원천징수 기준",
  effectiveFrom: "2024-03-01",
  effectiveTo: null,
  verifiedAt: "2026-08-25",
  status: "published",
  builtIn: true,
  employment: {
    tableRevision: "2024-02-29",
    tableRows: employmentTaxTable2024,
    taxAtTenMillion: employmentTaxAtTenMillion2024,
    childCredits: { one: 12500, two: 29160, additional: 25000 },
    allowedWithholdingRatios: [0.8, 1, 1.2],
    highIncomeBrackets: [
      { max: 14000000, excessFrom: 10000000, excessFactor: 0.98, rate: 0.35, baseAddition: 25000 },
      { max: 28000000, excessFrom: 14000000, excessFactor: 0.98, rate: 0.38, baseAddition: 1397000 },
      { max: 30000000, excessFrom: 28000000, excessFactor: 0.98, rate: 0.4, baseAddition: 6610600 },
      { max: 45000000, excessFrom: 30000000, excessFactor: 1, rate: 0.4, baseAddition: 7394600 },
      { max: 87000000, excessFrom: 45000000, excessFactor: 1, rate: 0.42, baseAddition: 13394600 },
      { max: null, excessFrom: 87000000, excessFactor: 1, rate: 0.45, baseAddition: 31034600 }
    ]
  },
  business: {
    incomeTaxRate: 0.03,
    localIncomeTaxRateOfIncomeTax: 0.1,
    personalServiceSmallAmountExempt: false
  },
  other: {
    defaultCategory: "temporaryLecture",
    categories: {
      temporaryLecture: {
        label: "일시적 강의·인적용역",
        expenseRate: 0.6,
        incomeTaxRate: 0.2,
        localIncomeTaxRateOfIncomeTax: 0.1,
        minimumTaxableIncomeAmount: 50000
      }
    }
  },
  sources: [
    { title: "국세청 근로소득 원천징수", url: NTS_SOURCE_URLS.employment },
    { title: "소득세법 시행령 별표 2 간이세액표", url: NTS_SOURCE_URLS.employmentTable },
    { title: "국세청 사업소득 원천징수", url: NTS_SOURCE_URLS.business },
    { title: "국세청 기타소득 원천징수", url: NTS_SOURCE_URLS.other },
    { title: "국세청 지방소득세 특별징수", url: NTS_SOURCE_URLS.withholdingOverview }
  ]
};

export const demoInsurancePolicy = {
  id: "DEMO-INSURANCE-2026-08",
  version: "DEMO-INSURANCE-2026-08",
  name: "사회보험 데모 기준",
  effectiveFrom: "2026-08-01",
  effectiveTo: null,
  status: "draft",
  employee: {
    nationalPension: { rate: 0.045, minimumBase: 0, maximumBase: 6370000, baseUnit: 1000, roundingUnit: 10 },
    healthInsurance: { rate: 0.03545, minimumBase: 0, maximumBase: 127056982, roundingUnit: 10 },
    longTermCareRate: 0.1295,
    longTermCareRoundingUnit: 10,
    employmentInsurance: { rate: 0.009, minimumBase: 0, maximumBase: 999999999, roundingUnit: 10 }
  }
};

const INSURANCE_SOURCE_URLS = {
  pensionRate: "https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0097M0.do",
  pensionBounds: "https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0038M0.do?menuId=MN24001113&tab=tab5",
  healthRate: "https://edi.nhis.or.kr/portal/images/popup/20251204_pop01longdesc.html",
  healthBounds: "https://law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000270472",
  longTermCare: "https://www.mohw.go.kr/menu.es?mid=a10712030100",
  employment: "https://www.moel.go.kr/info/astmgmt/employ/employList.do",
  calculator: "https://www.4insure.or.kr/pbiz/ntcn/inscSmlCalcView.do"
};

function insurancePolicy2026({ version, effectiveFrom, effectiveTo, pensionMinimumBase, pensionMaximumBase }) {
  return {
    id: version,
    version,
    name: "2026년 사회보험 근로자 부담 기준",
    effectiveFrom,
    effectiveTo,
    verifiedAt: "2026-08-26",
    status: "published",
    builtIn: true,
    employee: {
      nationalPension: {
        rate: 0.0475,
        minimumBase: pensionMinimumBase,
        maximumBase: pensionMaximumBase,
        baseUnit: 1000,
        roundingUnit: 10
      },
      healthInsurance: {
        rate: 0.03595,
        minimumBase: 0,
        maximumBase: Number.MAX_SAFE_INTEGER,
        minimumAmount: 10080,
        maximumAmount: 4591740,
        roundingUnit: 10
      },
      longTermCareRate: 0.009448 / 0.0719,
      longTermCareRoundingUnit: 10,
      employmentInsurance: {
        rate: 0.009,
        minimumBase: 0,
        maximumBase: Number.MAX_SAFE_INTEGER,
        roundingUnit: 10
      }
    },
    sources: [
      { kind: "nationalPension", title: "국민연금공단 2026년 보험료율", url: INSURANCE_SOURCE_URLS.pensionRate },
      { kind: "nationalPensionBounds", title: "국민연금 기준소득월액 상·하한", url: INSURANCE_SOURCE_URLS.pensionBounds },
      { kind: "healthInsurance", title: "국민건강보험공단 2026년 보험료율", url: INSURANCE_SOURCE_URLS.healthRate },
      { kind: "healthInsuranceBounds", title: "건강보험료 상·하한 고시", url: INSURANCE_SOURCE_URLS.healthBounds },
      { kind: "longTermCare", title: "보건복지부 2026년 장기요양보험료율", url: INSURANCE_SOURCE_URLS.longTermCare },
      { kind: "employmentInsurance", title: "고용노동부 고용보험 안내", url: INSURANCE_SOURCE_URLS.employment },
      { kind: "calculationRounding", title: "4대사회보험정보연계센터 보험료 모의계산", url: INSURANCE_SOURCE_URLS.calculator }
    ]
  };
}

export const officialInsurancePolicies = [
  insurancePolicy2026({
    version: "INSURANCE-2026-01",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-06-30",
    pensionMinimumBase: 400000,
    pensionMaximumBase: 6370000
  }),
  insurancePolicy2026({
    version: "INSURANCE-2026-07",
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    pensionMinimumBase: 410000,
    pensionMaximumBase: 6590000
  })
];

export function createCombinedPolicy(taxPolicy = ntsTaxPolicy2024, insurancePolicy = officialInsurancePolicies.at(-1)) {
  return {
    taxPolicy,
    insurancePolicy
  };
}
