/**
 * Instagram Graph API 서비스 모듈
 * 공식 Graph API를 통한 이미지 게시/예약 기능
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

let config = {
    accessToken: process.env.IG_ACCESS_TOKEN || '',
    accountId: process.env.IG_BUSINESS_ACCOUNT_ID || '',
    imgbbKey: process.env.IMGBB_API_KEY || ''
};

function configure(opts) {
    if (opts.accessToken) config.accessToken = opts.accessToken;
    if (opts.accountId) config.accountId = opts.accountId;
    if (opts.imgbbKey) config.imgbbKey = opts.imgbbKey;
}

function isConfigured() {
    return !!(config.accessToken && config.accountId);
}

/**
 * base64 이미지를 imgbb에 업로드하여 공개 URL을 얻습니다.
 * Graph API는 공개 URL에 호스팅된 이미지만 받습니다.
 */
async function uploadImageToImgbb(base64Data) {
    if (!config.imgbbKey) throw new Error('IMGBB_API_KEY가 설정되지 않았습니다.');

    // data:image/jpeg;base64, prefix 제거
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    const formData = new URLSearchParams();
    formData.append('key', config.imgbbKey);
    formData.append('image', cleanBase64);
    formData.append('expiration', '600'); // 10분 후 자동 삭제

    const res = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: formData
    });

    const data = await res.json();
    if (!data.success) {
        throw new Error('imgbb 업로드 실패: ' + (data.error?.message || JSON.stringify(data)));
    }

    console.log(`📸 imgbb 업로드 완료: ${data.data.url}`);
    return data.data.url;
}

/**
 * Graph API: 미디어 컨테이너 생성 (1단계)
 */
async function createMediaContainer(imageUrl, caption, scheduledTime = null) {
    if (!isConfigured()) throw new Error('Instagram API 토큰이 설정되지 않았습니다.');

    const params = new URLSearchParams({
        image_url: imageUrl,
        caption: caption || '',
        access_token: config.accessToken
    });

    // 예약 게시: published=false + scheduled_publish_time
    if (scheduledTime) {
        const unixTime = Math.floor(new Date(scheduledTime).getTime() / 1000);
        const now = Math.floor(Date.now() / 1000);
        const minTime = now + 10 * 60; // 최소 10분 후
        const maxTime = now + 75 * 24 * 60 * 60; // 최대 75일 후

        if (unixTime < minTime) throw new Error('예약 시간은 최소 10분 후여야 합니다.');
        if (unixTime > maxTime) throw new Error('예약 시간은 최대 75일 이내여야 합니다.');

        params.append('published', 'false');
        params.append('scheduled_publish_time', unixTime.toString());
    }

    const res = await fetch(`${GRAPH_API_BASE}/${config.accountId}/media`, {
        method: 'POST',
        body: params
    });

    const data = await res.json();
    if (data.error) {
        throw new Error(`컨테이너 생성 실패: ${data.error.message} (code: ${data.error.code})`);
    }

    console.log(`📦 미디어 컨테이너 생성: ${data.id}`);
    return data.id;
}

/**
 * Graph API: 미디어 게시 (2단계)
 * 예약 게시의 경우 이 단계에서 예약이 확정됩니다.
 */
async function publishMedia(containerId) {
    if (!isConfigured()) throw new Error('Instagram API 토큰이 설정되지 않았습니다.');

    const params = new URLSearchParams({
        creation_id: containerId,
        access_token: config.accessToken
    });

    const res = await fetch(`${GRAPH_API_BASE}/${config.accountId}/media_publish`, {
        method: 'POST',
        body: params
    });

    const data = await res.json();
    if (data.error) {
        throw new Error(`게시 실패: ${data.error.message} (code: ${data.error.code})`);
    }

    console.log(`✅ Instagram 게시 완료: ${data.id}`);
    return data.id;
}

/**
 * 컨테이너 상태 확인 (업로드 완료 대기)
 */
async function checkContainerStatus(containerId) {
    const res = await fetch(
        `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${config.accessToken}`
    );
    const data = await res.json();
    return data;
}

/**
 * 컨테이너가 준비될 때까지 폴링 (최대 30초)
 */
async function waitForContainer(containerId, maxWaitMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const status = await checkContainerStatus(containerId);
        if (status.status_code === 'FINISHED') return true;
        if (status.status_code === 'ERROR') {
            throw new Error(`컨테이너 처리 실패: ${status.status || '알 수 없는 오류'}`);
        }
        await new Promise(r => setTimeout(r, 2000)); // 2초 대기
    }
    throw new Error('컨테이너 처리 시간 초과 (30초)');
}

/**
 * 원스텝: base64 이미지 → Instagram 즉시 게시
 */
async function publishImage(base64Data, caption) {
    console.log('🚀 Instagram 즉시 게시 시작...');

    // 1) imgbb에 업로드 → 공개 URL
    const imageUrl = await uploadImageToImgbb(base64Data);

    // 2) 미디어 컨테이너 생성
    const containerId = await createMediaContainer(imageUrl, caption);

    // 3) 컨테이너 준비 대기
    await waitForContainer(containerId);

    // 4) 게시
    const mediaId = await publishMedia(containerId);

    return { success: true, mediaId, imageUrl };
}

/**
 * 원스텝: base64 이미지 → Instagram 예약 게시
 */
async function scheduleImage(base64Data, caption, scheduledTime) {
    console.log(`📅 Instagram 예약 게시: ${scheduledTime}`);

    // 1) imgbb에 업로드 (예약 게시에도 공개 URL 필요)
    const imageUrl = await uploadImageToImgbb(base64Data);

    // 2) 예약 컨테이너 생성 (published=false + scheduled_publish_time)
    const containerId = await createMediaContainer(imageUrl, caption, scheduledTime);

    // 3) 컨테이너 준비 대기
    await waitForContainer(containerId);

    // 4) 게시 API 호출 (예약이 확정됨)
    const mediaId = await publishMedia(containerId);

    return { success: true, mediaId, scheduledTime, imageUrl };
}

/**
 * 연결된 Instagram 비즈니스 계정 정보 조회
 */
async function getAccountInfo() {
    if (!isConfigured()) {
        return { connected: false, message: 'API 토큰이 설정되지 않았습니다.' };
    }

    try {
        const res = await fetch(
            `${GRAPH_API_BASE}/${config.accountId}?fields=username,name,profile_picture_url,followers_count,media_count&access_token=${config.accessToken}`
        );
        const data = await res.json();

        if (data.error) {
            return { connected: false, message: data.error.message };
        }

        return {
            connected: true,
            username: data.username,
            name: data.name,
            profilePicture: data.profile_picture_url,
            followers: data.followers_count,
            mediaCount: data.media_count
        };
    } catch (err) {
        return { connected: false, message: err.message };
    }
}

module.exports = {
    configure,
    isConfigured,
    uploadImageToImgbb,
    createMediaContainer,
    publishMedia,
    publishImage,
    scheduleImage,
    getAccountInfo
};
