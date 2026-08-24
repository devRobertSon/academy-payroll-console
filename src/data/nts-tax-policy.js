import {
  employmentTaxAtTenMillion2024,
  employmentTaxTable2024
} from "./employment-tax-table-2024.js";

export const NTS_SOURCE_URLS = {
  employment: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7862&mi=6583",
  employmentTable: "https://www.law.go.kr/flDownload.do?flSeq=127235479&gubun=",
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
    nationalPension: { rate: 0.045, minimumBase: 0, maximumBase: 6370000 },
    healthInsurance: { rate: 0.03545, minimumBase: 0, maximumBase: 127056982 },
    longTermCareRate: 0.1295,
    employmentInsurance: { rate: 0.009, minimumBase: 0, maximumBase: 999999999 }
  }
};

export function createCombinedPolicy(taxPolicy = ntsTaxPolicy2024, insurancePolicy = demoInsurancePolicy) {
  return {
    version: `${taxPolicy.version} / ${insurancePolicy.version}`,
    taxPolicy,
    insurancePolicy
  };
}
