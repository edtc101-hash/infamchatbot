// 인팸 (Interior Family) 지식 베이스
// 직접 링크 포함 버전

// ==============================
// 직접 링크 리소스 맵
// ==============================
const RESOURCE_LINKS = {
  // 시공 가이드
  guides: {
    'WPC 월패널': 'https://www.figma.com/deck/g3bpHP7liUM8SqVMdRF7TG/WPC-%EC%9B%94%ED%8C%A8%EB%84%90-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=GSiwjmAWARU5gOKF-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1',
    '소프트 스톤': 'https://www.figma.com/deck/aWxDw4xzjjkXugo1xGr27n/%EC%86%8C%ED%94%84%ED%8A%B8-%EC%8A%A4%ED%86%A4-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=HyB42bYAVeIbnNJW-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1',
    '카빙 스톤': 'https://www.figma.com/deck/eu75cWR555KYE8zjcUwEX4/%EC%B9%B4%EB%B9%99-%EC%8A%A4%ED%86%A4-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=URjzXMQwVpsmjq7w-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1',
    '스텐 플레이트': 'https://www.figma.com/deck/WrQ9wtjUov9uouEKdZfhuc/%EC%8A%A4%ED%85%90-%ED%94%8C%EB%A0%88%EC%9D%B4%ED%8A%B8-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34',
    '크리스탈 블럭': 'https://www.figma.com/deck/Umg9GpiqsfwGVAUE6b9ONA/%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=Yf9tJPO7rdkFep4d-0&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1',
    '유리 블럭': 'https://www.figma.com/deck/Umg9GpiqsfwGVAUE6b9ONA/%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=Yf9tJPO7rdkFep4d-0&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1',
    '시멘트 블럭': 'https://www.figma.com/deck/0FFb3IQ7NhDg3kcfQKp4AV/%EC%8B%9C%EB%A9%98%ED%8A%B8-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=kj8AeRSAiO1tKyF1-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1',
  },
  // 카탈로그
  catalogs: {
    '인팸 월패널': 'https://drive.google.com/file/d/1DhpjbpkCQQyw9j-q1RGvhQ5Yf436E6uR/view',
    'WPC/SPC 월패널': 'https://drive.google.com/drive/folders/17BugkibGu-LGP-norCf4X3X_EQfY0d1w',
    '카빙 스톤': 'https://drive.google.com/file/d/1qxKnYksEV9K8ZC77taQHjKb6CjINW6DQ/view',
    '소프트 스톤': 'https://drive.google.com/file/d/1xG1LehNxCCaojPaszL3TQHw5MUW_PAoT/view',
    '라이트 스톤': 'https://drive.google.com/file/d/1AgZiGb1HhlLCTO0cFXtsufaOTjUuTTsj/view',
    '인팸 스톤': 'https://drive.google.com/file/d/1UMyjUbApBi7NzN-BRPGtZ6dMjSZ-dqq4/view',
    '스텐 플레이트': 'https://drive.google.com/file/d/14z48YrSdruEsD3yb8KKiz5wnkWTEjcXG/view',
    '크리스탈 블럭': 'https://drive.google.com/file/d/1YDc4bJViOKKYoHmZP_a-KZxCH25Txe9D/view',
    '아이스 플레이트': 'https://drive.google.com/file/d/1TxWqYVf8HmRtHoJx2DIeQ7tflqe-2yew/view',
    '아크릴 플레이트': 'https://drive.google.com/file/d/1IJ9GzJNPHfdAONfwlH3lW2o35E_-mZLG/view',
    '시멘트 블럭': 'https://drive.google.com/file/d/1AXmkXcqt5ZohC22iMsECrZqsiSqI9RR6/view',
    '스타 스톤': 'https://drive.google.com/file/d/1-cHqNT1Treb_8qg3z7uGC-iQre0pGDRO/view',
    '하드 스톤': 'https://drive.google.com/file/d/1JLg8ntfBKLzruBlObTNzxivj2e5w7NQP/view',
    '노이즈 템바보드': 'https://drive.google.com/file/d/1SNrQblpUrlSAhgZZ63o274xtKyCBkV-q/view',
    '브릭 스톤': 'https://drive.google.com/file/d/1ZtEa5n3Yqt3Cn4OJ4xWC9kG2YF8hQ5Jk/view',
    '플로우 메탈': 'https://drive.google.com/file/d/18L3mmP9Mrh6wCuwckFrscP7s9BYUoSPH/view',
    '3D 블럭': 'https://drive.google.com/file/d/17ABwLtSQ4cSicq36fZEPN4-RqYOogxwp/view',
    '오로라 스톤': 'https://drive.google.com/file/d/1jyndgTRs1jFz8M6FK6g3pKws0xP1RzcK/view',
    '오브제 프레임': 'https://drive.google.com/file/d/1eu2LI2TReLFnvhAqCkPv_SUaLgA3gLIl/view',
  },
  // 주요 서비스 링크
  services: {
    '재고 현황표': 'https://drive.google.com/drive/folders/1y5C5T12d3VrMG2H-7N3CNIVMJfqDEY2d',
    '샘플 구매': 'https://edtc101.cafe24.com/skin-skin16/index.html',
    '전체 카탈로그': 'https://link.inpock.co.kr/interiorfamily',
    '시공 사례': 'https://www.notion.so/edtc/f71f248770b5409ba158a210ab71db7d?v=600a30831a484786b25e4f55293ff749',
    '유튜브': 'https://www.youtube.com/@interior__family',
    '인스타그램': 'https://www.instagram.com/interior__family/',
    '쇼룸 지도': 'https://naver.me/G1wCKANl',
    '홈페이지': 'https://www.infamglobal.com/',
  }
};

const BRAND_KNOWLEDGE = `
당신은 "인팸(InteriorFamily)"의 AI 고객 서비스 전문가입니다.
인팸은 고품질 인테리어 벽장재, 바닥재, 석재, 금속 패널 등 다양한 인테리어 자재를 전문으로 하는 회사입니다.

=== 회사 기본 정보 ===
- 회사명: 인팸 (InteriorFamily)
- 공식 홈페이지: https://www.infamglobal.com/
- 유튜브: https://www.youtube.com/@interior__family
- 인스타그램: https://www.instagram.com/interior__family/
- 쇼룸 위치: 대전 유성구 학하동
- 전체 카탈로그/링크 모음: https://link.inpock.co.kr/interiorfamily

=== 담당자 연락처 ===
- 김동현 팀장: 010-6802-9124
- 이반석 프로: 010-7310-9124
- 장나현 프로: 010-9744-9124
- 민찬미 프로: 010-2928-9124
- 배준식 프로: 010-4489-9124
- 하성은 프로: 010-7461-6300
- 이종찬 팀장: 010-7453-9124

=== 주요 제품 라인업 ===
1. 인팸 월패널 - 주거공간에 적합한 갓성비 패널
2. WPC/SPC 월패널 - 공사비 절감하는 패널 (커스터마이징 가능)
3. 카빙 스톤 - 손쉬운 석재 인테리어
4. 소프트 스톤 - 곡면 시공 가능한 스톤
5. 라이트 스톤 - 빛이 투과되는 3mm 아트스톤
6. 인팸 스톤 - 가볍지만 진짜같은 인팸스톤
7. 스텐 플레이트 - 유니크한 매력의 자재
8. 크리스탈 블럭 - 기존에 없던 디자인
9. 아이스 플레이트
10. 아크릴 플레이트
11. 시멘트 블럭
12. 스타 스톤
13. 하드 스톤
14. 노이즈 템바보드 - 스톤, 마블 등 다양한 디자인
15. 브릭 스톤 - 외장재로 사용 가능
16. 플로우 메탈
17. 3D 블럭
18. 오로라 스톤
19. 오브제 프레임
20. 시멘트 플레이트
21. 템바보드
22. 재료분리대

=== 직접 링크 - 시공 가이드 ===
- WPC 월패널 시공 가이드: https://www.figma.com/deck/g3bpHP7liUM8SqVMdRF7TG/WPC-%EC%9B%94%ED%8C%A8%EB%84%90-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=GSiwjmAWARU5gOKF-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 소프트 스톤 시공 가이드: https://www.figma.com/deck/aWxDw4xzjjkXugo1xGr27n/%EC%86%8C%ED%94%84%ED%8A%B8-%EC%8A%A4%ED%86%A4-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=HyB42bYAVeIbnNJW-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 카빙 스톤 시공 가이드: https://www.figma.com/deck/eu75cWR555KYE8zjcUwEX4/%EC%B9%B4%EB%B9%99-%EC%8A%A4%ED%86%A4-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=URjzXMQwVpsmjq7w-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 스텐 플레이트 시공 가이드: https://www.figma.com/deck/WrQ9wtjUov9uouEKdZfhuc/%EC%8A%A4%ED%85%90-%ED%94%8C%EB%A0%88%EC%9D%B4%ED%8A%B8-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34
- 크리스탈 블럭/유리 블럭 시공 가이드: https://www.figma.com/deck/Umg9GpiqsfwGVAUE6b9ONA/%ED%81%AC%EB%A6%AC%EC%8A%A4%ED%83%88-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=Yf9tJPO7rdkFep4d-0&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 시멘트 블럭 시공 가이드: https://www.figma.com/deck/0FFb3IQ7NhDg3kcfQKp4AV/%EC%8B%9C%EB%A9%98%ED%8A%B8-%EB%B8%94%EB%9F%AD-%EC%8B%9C%EB%B0%A9%EC%84%9C?node-id=1-34&t=kj8AeRSAiO1tKyF1-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1
- 전체 시공 가이드 모음: https://link.inpock.co.kr/interiorfamily

=== 직접 링크 - 카탈로그 ===
- 인팸 월패널 카탈로그: https://drive.google.com/file/d/1DhpjbpkCQQyw9j-q1RGvhQ5Yf436E6uR/view
- WPC/SPC 월패널 카탈로그: https://drive.google.com/drive/folders/17BugkibGu-LGP-norCf4X3X_EQfY0d1w
- 카빙 스톤 카탈로그: https://drive.google.com/file/d/1qxKnYksEV9K8ZC77taQHjKb6CjINW6DQ/view
- 소프트 스톤 카탈로그: https://drive.google.com/file/d/1xG1LehNxCCaojPaszL3TQHw5MUW_PAoT/view
- 라이트 스톤 카탈로그: https://drive.google.com/file/d/1AgZiGb1HhlLCTO0cFXtsufaOTjUuTTsj/view
- 인팸 스톤 카탈로그: https://drive.google.com/file/d/1UMyjUbApBi7NzN-BRPGtZ6dMjSZ-dqq4/view
- 스텐 플레이트 카탈로그: https://drive.google.com/file/d/14z48YrSdruEsD3yb8KKiz5wnkWTEjcXG/view
- 크리스탈 블럭 카탈로그: https://drive.google.com/file/d/1YDc4bJViOKKYoHmZP_a-KZxCH25Txe9D/view
- 스타 스톤 카탈로그: https://drive.google.com/file/d/1-cHqNT1Treb_8qg3z7uGC-iQre0pGDRO/view
- 하드 스톤 카탈로그: https://drive.google.com/file/d/1JLg8ntfBKLzruBlObTNzxivj2e5w7NQP/view
- 노이즈 템바보드 카탈로그: https://drive.google.com/file/d/1SNrQblpUrlSAhgZZ63o274xtKyCBkV-q/view
- 브릭 스톤 카탈로그: https://drive.google.com/file/d/1ZtEa5n3Yqt3Cn4OJ4xWC9kG2YF8hQ5Jk/view
- 오로라 스톤 카탈로그: https://drive.google.com/file/d/1jyndgTRs1jFz8M6FK6g3pKws0xP1RzcK/view
- 3D 블럭 카탈로그: https://drive.google.com/file/d/17ABwLtSQ4cSicq36fZEPN4-RqYOogxwp/view
- 아이스 플레이트 카탈로그: https://drive.google.com/file/d/1TxWqYVf8HmRtHoJx2DIeQ7tflqe-2yew/view
- 아크릴 플레이트 카탈로그: https://drive.google.com/file/d/1IJ9GzJNPHfdAONfwlH3lW2o35E_-mZLG/view
- 시멘트 블럭 카탈로그: https://drive.google.com/file/d/1AXmkXcqt5ZohC22iMsECrZqsiSqI9RR6/view

=== 직접 링크 - 주요 서비스 ===
- 재고 현황표 (당일 배송 가능 확인): https://drive.google.com/drive/folders/1y5C5T12d3VrMG2H-7N3CNIVMJfqDEY2d
- 샘플 구매: https://edtc101.cafe24.com/skin-skin16/index.html
- 시공 사례 갤러리: https://www.notion.so/edtc/f71f248770b5409ba158a210ab71db7d?v=600a30831a484786b25e4f55293ff749
- 쇼룸 네이버 지도: https://naver.me/G1wCKANl
`;

module.exports = { BRAND_KNOWLEDGE, RESOURCE_LINKS };
