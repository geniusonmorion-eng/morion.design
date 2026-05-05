const site = document.getElementById('site');
const leftCol = document.querySelector('.col-left');
const rightCol = document.querySelector('.col-right');
const leftTrack = leftCol?.querySelector('.track');
const rightTrack = rightCol?.querySelector('.track');

const PADDING = 8;
const BOUNDS_PAD = 16;
const SCROLL_EASE = 0;
const DRAG_AMOUNT = 0;
const PADDING_RATIO = 0.3;
const UPPER_BP = 1180;
const LOWER_BP = 1000;
const RATIO_SPRING = 0.18;
const SPLIT_BP = 700;

const hasGsap = typeof window.gsap !== 'undefined';

function clamp(value, min = 0, max = 1) {
	return Math.min(max, Math.max(min, value));
}

function expoInOut(value) {
	if (hasGsap && window.gsap.parseEase) return window.gsap.parseEase('expo.inOut')(value);
	if (value === 0 || value === 1) return value;
	if (value < 0.5) return Math.pow(2, 20 * value - 10) / 2;
	return (2 - Math.pow(2, -20 * value + 10)) / 2;
}

function animateProp(proxy, prop, target, options = {}) {
	const { duration = 1, ease = expoInOut, onUpdate, onComplete } = options;
	if (hasGsap) {
		window.gsap.to(proxy, {
			[prop]: target,
			duration,
			ease: 'expo.inOut',
			overwrite: 'auto',
			onUpdate,
			onComplete
		});
		return;
	}

	const from = proxy[prop];
	const started = performance.now();
	function frame(now) {
		const progress = clamp((now - started) / (duration * 1000));
		proxy[prop] = from + (target - from) * ease(progress);
		onUpdate?.();
		if (progress < 1) requestAnimationFrame(frame);
		else onComplete?.();
	}
	requestAnimationFrame(frame);
}

function createScroll() {
	return {
		y: 0,
		yRatio: 0,
		delta: 0,
		bounds: { max: 0, min: 0 },
		scrollEase: SCROLL_EASE
	};
}

const leftScroll = createScroll();
const rightScroll = createScroll();

const state = {
	ratio: 0.5,
	ratioMouseTarget: 0.5,
	initialWheel: true,
	isDown: false,
	downPos: 0,
	lastDelta: 0,
	speed: 0,
	splitListenersBound: false,
	sitePointerBound: false,
	ratioLeaveTween: false
};

const ratioProxy = { ratio: 0.5 };
const galleryVideoSyncers = new Set();
let lastGalleryVideoSync = 0;
const VIDEO_SYNC_INTERVAL = 250;

function isSplit() {
	return window.innerWidth >= SPLIT_BP;
}

function moveAmount() {
	const w = window.innerWidth;
	const small = 0.32;
	const large = 0.4;
	if (w < LOWER_BP) return small;
	if (w >= UPPER_BP) return large;
	return small + (large - small) * ((w - LOWER_BP) / (UPPER_BP - LOWER_BP));
}

function activeSide() {
	return state.ratio < 0.5 ? 'left' : 'right';
}

function isScrollableInDirection(sc, deltaY) {
	if (deltaY < 0) return sc.yRatio > 0;
	if (deltaY > 0) return sc.yRatio < 1;
	return false;
}

function addDelta(deltaY) {
	const side = activeSide();

	if (side === 'right') {
		leftScroll.delta = deltaY;
		rightScroll.delta = isScrollableInDirection(leftScroll, deltaY) ? deltaY * DRAG_AMOUNT : 0;
	} else {
		rightScroll.delta = deltaY;
		leftScroll.delta = isScrollableInDirection(rightScroll, deltaY) ? deltaY * DRAG_AMOUNT : 0;
	}
}

function applyRatioDelta() {
	const apply = (sc) => {
		if (sc.delta === 0) return;
		const px = sc.bounds.max > 0 ? 1 / sc.bounds.max : 0;
		sc.yRatio = clamp(sc.yRatio + sc.delta * px);
		sc.delta = 0;
	};
	apply(leftScroll);
	apply(rightScroll);
}

function tweenYToTarget(sc) {
	const target = sc.yRatio * sc.bounds.max;
	if (sc.scrollEase < 0.01 || !hasGsap) {
		sc.y = target;
		return;
	}
	window.gsap.to(sc, {
		y: target,
		duration: sc.scrollEase,
		ease: 'expo.out',
		overwrite: 'auto'
	});
}

function updateBounds(track, sc) {
	if (!track) return;
	const height = track.scrollHeight;
	sc.bounds.max = Math.max(0, height - window.innerHeight + BOUNDS_PAD);
	sc.yRatio = sc.bounds.max > 0 ? clamp(sc.y / sc.bounds.max) : 0;
	tweenYToTarget(sc);
}

function setupScrollAdapter(track, sc) {
	if (!track) return;
	updateBounds(track, sc);
	if ('ResizeObserver' in window) {
		const ro = new ResizeObserver(() => updateBounds(track, sc));
		ro.observe(track);
	} else {
		window.addEventListener('resize', () => updateBounds(track, sc));
	}
}

function changeSide(side) {
	if (hasGsap) window.gsap.killTweensOf(ratioProxy);
	state.ratio = side === 'left' ? 0 : 1;
	state.ratioMouseTarget = state.ratio;
}

function onMouseMove(e) {
	if (!isSplit() || !site) return;
	const windowWidth = window.innerWidth;
	const padding = 0.5 - PADDING_RATIO;
	const totalSize = windowWidth * padding * 2;
	const delta = windowWidth - totalSize;
	const clientX = e.clientX - delta / 2;
	const t = clamp(clientX / totalSize);
	state.ratioMouseTarget = expoInOut(1 - t);
}

function onEnterWindow() {
	if (hasGsap) window.gsap.killTweensOf(ratioProxy);
	state.ratioLeaveTween = false;
}

function onLeaveWindow() {
	if (!isSplit()) return;
	state.ratioMouseTarget = 0.5;
	state.ratioLeaveTween = true;
	ratioProxy.ratio = state.ratio;
	animateProp(ratioProxy, 'ratio', 0.5, {
		duration: 1,
		onUpdate: () => { state.ratio = ratioProxy.ratio; },
		onComplete: () => { state.ratioLeaveTween = false; }
	});
}

function onWheel(e) {
	if (!isSplit()) return;
	if (state.initialWheel) {
		const side = e.pageX > window.innerWidth / 2 ? 'left' : 'right';
		changeSide(side);
		state.initialWheel = false;
	}
	addDelta(e.deltaY);
}

function onDown(e) {
	if (!isSplit() || e.touches.length <= 0) return;
	state.isDown = true;
	state.downPos = e.touches[0].pageY;
	state.lastDelta = 0;
	const downPosX = e.touches[0].pageX;
	changeSide(downPosX / window.innerWidth > 0.5 ? 'left' : 'right');
}

function onUp() {
	state.isDown = false;
}

function onMove(e) {
	if (!isSplit() || e.touches.length <= 0) return;
	const pageY = e.touches[0].pageY;
	const delta = state.downPos - pageY;
	state.speed = (delta - state.lastDelta) * 1.2;
	state.lastDelta = delta;
	addDelta(state.speed);
}

function bindSplitListeners(add) {
	if (add && !state.splitListenersBound) {
		window.addEventListener('wheel', onWheel, { passive: true });
		window.addEventListener('touchstart', onDown, { passive: true });
		window.addEventListener('touchend', onUp, { passive: true });
		window.addEventListener('touchmove', onMove, { passive: true });
		state.splitListenersBound = true;
	} else if (!add && state.splitListenersBound) {
		window.removeEventListener('wheel', onWheel);
		window.removeEventListener('touchstart', onDown);
		window.removeEventListener('touchend', onUp);
		window.removeEventListener('touchmove', onMove);
		state.splitListenersBound = false;
	}
}

function bindSitePointer(add) {
	if (!site) return;
	if (add && !state.sitePointerBound) {
		site.addEventListener('mousemove', onMouseMove);
		document.documentElement.addEventListener('mouseleave', onLeaveWindow);
		document.documentElement.addEventListener('mouseenter', onEnterWindow);
		state.sitePointerBound = true;
	} else if (!add && state.sitePointerBound) {
		site.removeEventListener('mousemove', onMouseMove);
		document.documentElement.removeEventListener('mouseleave', onLeaveWindow);
		document.documentElement.removeEventListener('mouseenter', onEnterWindow);
		state.sitePointerBound = false;
	}
}

function resetColumnTransforms() {
	[leftCol, rightCol].forEach((col) => {
		if (!col) return;
		col.style.transform = '';
		col.style.transformOrigin = '';
	});
	[leftTrack, rightTrack].forEach((track) => {
		if (track) track.style.gap = '';
	});
}

const mobileScrollPositions = { left: 0, right: 0 };
let mobileSide = null;

function moveIndicator(tab) {
	const tabsIndicator = document.getElementById('tabs-indicator');
	if (!tabsIndicator || !tab) return;
	tabsIndicator.style.width = `${tab.offsetWidth}px`;
	tabsIndicator.style.transform = `translateX(${tab.offsetLeft}px)`;
}

function setMobileSide(target, options = {}) {
	const { restore = true } = options;
	if (isSplit()) return;
	const current = mobileSide;
	if (current) mobileScrollPositions[current] = window.scrollY;
	mobileSide = target;

	document.querySelectorAll('.mobile-tab').forEach((tab) => {
		const active = tab.getAttribute('data-target') === target;
		tab.classList.toggle('active', active);
		tab.setAttribute('aria-pressed', active ? 'true' : 'false');
		if (active) requestAnimationFrame(() => moveIndicator(tab));
	});

	leftCol?.classList.toggle('hidden', target !== 'left');
	rightCol?.classList.toggle('visible', target === 'right');
	requestAnimationFrame(() => {
		galleryVideoSyncers.forEach((syncVideos) => syncVideos());
	});

	if (restore) {
		requestAnimationFrame(() => {
			window.scrollTo({ top: mobileScrollPositions[target] || 0, left: 0 });
		});
	}
}

function initialMobileSide() {
	return window.location.hash.startsWith('#work-') ? 'left' : 'right';
}

function syncSplitMode() {
	const split = isSplit();
	bindSplitListeners(split);
	bindSitePointer(split);
	document.documentElement.classList.toggle('is-split', split);
	document.body.classList.toggle('is-split', split);

	if (split) {
		state.initialWheel = true;
		if (mobileSide) {
			leftCol?.classList.remove('hidden');
			rightCol?.classList.remove('visible');
		}
		mobileSide = null;
	} else {
		leftScroll.y = 0;
		rightScroll.y = 0;
		resetColumnTransforms();
		if (!mobileSide) setMobileSide(initialMobileSide(), { restore: false });
	}
}

function tick() {
	if (isSplit() && leftCol && rightCol && leftTrack && rightTrack) {
		if (state.splitListenersBound) {
			if (state.isDown) {
				state.speed *= 0.7;
			} else {
				if (Math.abs(state.speed) > 1e-6) addDelta(state.speed);
				state.speed *= 0.94;
			}
		}

		if (!state.ratioLeaveTween) {
			state.ratio += (state.ratioMouseTarget - state.ratio) * RATIO_SPRING;
		}

		applyRatioDelta();
		tweenYToTarget(leftScroll);
		tweenYToTarget(rightScroll);

		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const baseWidth = vw * 0.5;
		const ma = moveAmount();
		const t = ma + state.ratio * (1 - ma * 2);
		const leftRatio = t;
		const rightRatio = 1 - t;

		const leftWidth = vw * leftRatio - PADDING * 1.5;
		const rightWidth = vw * rightRatio - PADDING * 1.5;
		const leftX = PADDING;
		const rightX = leftX + leftWidth + PADDING;
		const leftScale = leftWidth / baseWidth;
		const rightScale = rightWidth / baseWidth;

		const halfH = vh * 0.5;
		const originLeft = leftScroll.y + vh / 2;
		const originRight = rightScroll.y + vh / 2;
		const offL = (halfH - halfH * leftScale) * (leftScroll.yRatio * 2 - 1);
		const offR = (halfH - halfH * rightScale) * (rightScroll.yRatio * 2 - 1);
		const tyL = -leftScroll.y + offL;
		const tyR = -rightScroll.y + offR;

		leftCol.style.transformOrigin = `0px ${originLeft}px`;
		rightCol.style.transformOrigin = `0px ${originRight}px`;
		leftCol.style.transform = `translate3d(${leftX}px, ${tyL}px, 0) scale(${leftScale})`;
		rightCol.style.transform = `translate3d(${rightX}px, ${tyR}px, 0) scale(${rightScale})`;
		leftTrack.style.gap = `${PADDING / leftScale}px`;
		rightTrack.style.gap = `${PADDING / rightScale}px`;

		const now = performance.now();
		if (now - lastGalleryVideoSync > VIDEO_SYNC_INTERVAL) {
			lastGalleryVideoSync = now;
			galleryVideoSyncers.forEach((syncVideos) => syncVideos());
		}
	}

	requestAnimationFrame(tick);
}

function navigateTo(href) {
	if (!href) return;
	document.body.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1), transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
	document.body.style.opacity = '0';
	document.body.style.transform = 'scale(0.98)';
	setTimeout(() => { window.location.href = href; }, 700);
}

function setupCursor() {
	const cursorFollow = document.getElementById('cursor-follow');
	if (!cursorFollow) return;
	let cursorX = 0;
	let cursorY = 0;
	let targetX = 0;
	let targetY = 0;
	let isOver = false;

	document.addEventListener('mousemove', (e) => {
		targetX = e.clientX;
		targetY = e.clientY;
		const el = document.elementFromPoint(e.clientX, e.clientY);
		const onGallery = Boolean(el?.closest('.case .gallery'));
		if (onGallery && !isOver) {
			isOver = true;
			cursorFollow.classList.add('visible');
			document.body.classList.add('cursor-hidden');
		} else if (!onGallery && isOver) {
			isOver = false;
			cursorFollow.classList.remove('visible');
			document.body.classList.remove('cursor-hidden');
		}
	});

	function animateCursor() {
		cursorX += (targetX - cursorX) * 0.15;
		cursorY += (targetY - cursorY) * 0.15;
		cursorFollow.style.left = `${cursorX}px`;
		cursorFollow.style.top = `${cursorY}px`;
		requestAnimationFrame(animateCursor);
	}
	animateCursor();
}

function setupIntroVideo() {
	const introVideo = document.getElementById('intro-video');
	if (!introVideo) return;

	const play = () => introVideo.play().catch(() => {});
	const pause = () => introVideo.pause();

	if ('IntersectionObserver' in window) {
		const observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) play();
				else pause();
			});
		}, { threshold: 0.2 });
		observer.observe(introVideo);
	} else {
		play();
	}
}

function playGalleryVideo(video) {
	if (video.dataset.loadRequested !== 'true' && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
		video.dataset.loadRequested = 'true';
		if (video.preload === 'none') video.preload = 'metadata';
		video.load();
	}
	video.play().catch(() => {});
}

function pauseGalleryVideo(video) {
	if (!video.paused) video.pause();
}

function setupGalleries() {
	document.querySelectorAll('.case').forEach((caseEl) => {
		const track = caseEl.querySelector('.gallery-track');
		const slides = Array.from(caseEl.querySelectorAll('.slide'));
		const prevBtn = caseEl.querySelector('.arrow.prev');
		const nextBtn = caseEl.querySelector('.arrow.next');
		const curEl = caseEl.querySelector('.pagination .cur');
		const totalEl = caseEl.querySelector('.pagination .tot');
		const gallery = caseEl.querySelector('.gallery');
		const href = caseEl.getAttribute('data-href');
		const total = slides.length;
		let index = 0;
		let touchStartX = 0;
		let touchStartY = 0;
		let swiped = false;
		let isVisible = false;

		const updateVisibility = () => {
			const rect = caseEl.getBoundingClientRect();
			isVisible = rect.width > 0 && rect.height > 0 && rect.bottom > -240 && rect.top < window.innerHeight + 240;
		};

		if (totalEl) totalEl.textContent = String(total).padStart(2, '0');

		const syncVideos = () => {
			updateVisibility();
			slides.forEach((slide, i) => {
				slide.querySelectorAll('video').forEach((video) => {
					const shouldAutoplay = video.autoplay || video.dataset.autoplay === 'true';
					if (isVisible && i === index && shouldAutoplay) playGalleryVideo(video);
					else pauseGalleryVideo(video);
				});
			});
		};

		const render = () => {
			if (track) track.style.transform = `translateX(${-index * 100}%)`;
			if (curEl) curEl.textContent = String(index + 1).padStart(2, '0');
			syncVideos();
		};

		galleryVideoSyncers.add(syncVideos);

		const go = (dir) => {
			if (!total) return;
			index = (index + dir + total) % total;
			render();
		};

		prevBtn?.addEventListener('click', (e) => {
			e.stopPropagation();
			go(-1);
		});
		nextBtn?.addEventListener('click', (e) => {
			e.stopPropagation();
			go(1);
		});

		if (gallery) {
			gallery.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					navigateTo(href);
				}
			});

			gallery.addEventListener('touchstart', (e) => {
				touchStartX = e.touches[0].clientX;
				touchStartY = e.touches[0].clientY;
				swiped = false;
			}, { passive: true });

			gallery.addEventListener('touchmove', (e) => {
				const dx = e.touches[0].clientX - touchStartX;
				const dy = e.touches[0].clientY - touchStartY;
				if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) swiped = true;
			}, { passive: true });

			gallery.addEventListener('touchend', (e) => {
				const dx = e.changedTouches[0].clientX - touchStartX;
				if (swiped) {
					if (dx < -30) go(1);
					else if (dx > 30) go(-1);
					return;
				}
				navigateTo(href);
			});

			gallery.addEventListener('click', (e) => {
				if (e.target.closest('.arrow') || swiped) return;
				e.preventDefault();
				navigateTo(href);
			});
			gallery.style.cursor = 'pointer';
		}

		if ('IntersectionObserver' in window) {
			const observer = new IntersectionObserver((entries) => {
				entries.forEach((entry) => {
					isVisible = entry.isIntersecting;
					render();
				});
			}, { rootMargin: '240px 0px', threshold: 0.01 });
			observer.observe(caseEl);
		}

		render();
	});
}

function accordionPads() {
	if (window.innerWidth >= 1200) {
		return { topBase: 16, topExtra: 18, bottomBase: 80, bottomExtra: 20 };
	}
	if (window.innerWidth >= 700) {
		return { topBase: 9, topExtra: 11, bottomBase: 32, bottomExtra: 0 };
	}
	return { topBase: 8, topExtra: 10, bottomBase: 32, bottomExtra: 0 };
}

function setupAccordions() {
	document.querySelectorAll('.accordion-container').forEach((ac) => {
		const caseEl = ac.closest('.case');
		const btn = ac.querySelector('.read-more');
		const content = ac.querySelector('.content');
		if (!btn || !content) return;

		btn.innerHTML = '<span class="line"></span><span class="line"></span>';
		const [line1, line2] = btn.querySelectorAll('.line');
		const proxy = { ratio: 0 };
		const slug = caseEl?.getAttribute('data-slug');
		let isOpen = false;
		let tweening = false;

		function applyRatio(r) {
			const totalH = content.scrollHeight;
			if (r >= 1) content.style.height = 'auto';
			else if (r <= 0) content.style.height = '0';
			else content.style.height = `${Math.round(r * totalH)}px`;

			const pads = accordionPads();
			ac.style.paddingTop = `${pads.topBase + pads.topExtra * r}px`;
			ac.style.paddingBottom = `${pads.bottomBase + pads.bottomExtra * r}px`;
			line1.style.transform = `rotate(${180 * (1 - r)}deg)`;
			line2.style.transform = `rotate(${90 * (1 - r)}deg)`;
		}

		function setHash(open) {
			if (!slug) return;
			const cleanUrl = `${window.location.pathname}${window.location.search}`;
			if (open) {
				window.history.replaceState(null, '', `${cleanUrl}#work-${slug}`);
			} else if (window.location.hash === `#work-${slug}`) {
				window.history.replaceState(null, '', cleanUrl);
			}
		}

		function setOpen(open, immediate = false) {
			if (tweening && !immediate) return;
			isOpen = open;
			btn.setAttribute('aria-expanded', open ? 'true' : 'false');
			setHash(open);

			if (immediate) {
				proxy.ratio = open ? 1 : 0;
				applyRatio(proxy.ratio);
				return;
			}

			tweening = true;
			animateProp(proxy, 'ratio', open ? 1 : 0, {
				duration: 1,
				onUpdate: () => applyRatio(proxy.ratio),
				onComplete: () => { tweening = false; }
			});
		}

		applyRatio(0);
		if (slug && window.location.hash === `#work-${slug}`) {
			setOpen(true, true);
			if (!isSplit()) setMobileSide('left', { restore: false });
		}

		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			setOpen(!isOpen);
		});
	});
}

function setupKeyboardNavigation() {
	document.addEventListener('keydown', (e) => {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(document.activeElement?.tagName)) return;

		const cases = Array.from(document.querySelectorAll('.case'));
		const vh = window.innerHeight;
		let best = null;
		let bestDist = Infinity;
		cases.forEach((caseEl) => {
			const r = caseEl.getBoundingClientRect();
			const center = r.top + r.height / 2;
			const dist = Math.abs(center - vh / 2);
			if (dist < bestDist) {
				bestDist = dist;
				best = caseEl;
			}
		});

		const btn = e.key === 'ArrowLeft'
			? best?.querySelector('.arrow.prev')
			: best?.querySelector('.arrow.next');
		btn?.click();
	});
}

function setupMobileTabs() {
	document.querySelectorAll('.mobile-tab').forEach((tab) => {
		tab.addEventListener('click', () => {
			const target = tab.getAttribute('data-target') || 'right';
			setMobileSide(target);
		});
	});
}

function setupClock() {
	const clockEl = document.getElementById('msk-clock');
	if (!clockEl) return;
	function updateClock() {
		const now = new Date();
		const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
		const h = String(msk.getHours()).padStart(2, '0');
		const m = String(msk.getMinutes()).padStart(2, '0');
		const s = String(msk.getSeconds()).padStart(2, '0');
		clockEl.textContent = `${h}:${m}:${s}`;
	}
	updateClock();
	setInterval(updateClock, 1000);
}

function disableEnhancedLayout() {
	document.documentElement.classList.remove('js-ready', 'is-split');
	document.body.classList.remove('is-split');
	bindSplitListeners(false);
	bindSitePointer(false);
	resetColumnTransforms();
}

function init() {
	if (!site || !leftCol || !rightCol || !leftTrack || !rightTrack) return;
	try {
		document.documentElement.classList.add('js-ready');
		setupScrollAdapter(leftTrack, leftScroll);
		setupScrollAdapter(rightTrack, rightScroll);
		setupMobileTabs();
		syncSplitMode();
		setupGalleries();
		setupAccordions();
		setupKeyboardNavigation();
		setupCursor();
		setupIntroVideo();
		setupClock();
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) document.querySelectorAll('video').forEach((video) => pauseGalleryVideo(video));
			else {
				galleryVideoSyncers.forEach((syncVideos) => syncVideos());
				const introVideo = document.getElementById('intro-video');
				const rect = introVideo?.getBoundingClientRect();
				if (introVideo && rect && rect.bottom > 0 && rect.top < window.innerHeight) {
					introVideo.play().catch(() => {});
				}
			}
		});
		window.addEventListener('resize', syncSplitMode);
		requestAnimationFrame(tick);
	} catch (error) {
		console.error(error);
		disableEnhancedLayout();
	}
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}
