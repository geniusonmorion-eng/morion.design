/* ======================================================================
   Механика как на norgram.co (scroll-controller + split-controller + side).

   ScrollAdapter: bounds.max = contentRect.height − innerHeight + 16
   Scroll: yRatio из delta; y — GSAP quickTo / expo.out, scrollEase 0.4
   Wheel: первый — changeSide (= goto 0 или 1), затем addDelta
   activeSide для addDelta: ratio < 0.5 ? 'left' : 'right' (дельта только на активной колонке)
   Touch: speed + loop, как в оригинале (isDown → speed*=0.7; иначе addDelta+decay)
   Split: moveAmount, paddingRatio 0.3, mousemove на #site, expo.inOut
   mouseleave → gsap ratio→0.5; mouseenter → killTweensOf
   Side: translate3d, scale, origin, scaleOffset
   Split layout: innerWidth >= 1000
   ====================================================================== */

const site = document.getElementById('site');
const leftCol = document.querySelector('.col-left');
const rightCol = document.querySelector('.col-right');
const leftTrack = leftCol.querySelector('.track');
const rightTrack = rightCol.querySelector('.track');

const PADDING = 8;
const BOUNDS_PAD = 16;
const SCROLL_EASE = 0.4;
const PADDING_RATIO = 0.3;
const UPPER_BP = 1180;
const LOWER_BP = 1000;
const RATIO_SPRING = 0.18;

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

let quickYLeft;
let quickYRight;

const ratioProxy = { ratio: 0.5 };

function isSplit() {
	return window.innerWidth >= 1000;
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

function addDelta(deltaY) {
	const L = leftScroll;
	const R = rightScroll;
	const side = activeSide();

	// Только активная колонка скроллится; вторая остаётся неподвижной.
	if (side === 'right') {
		L.delta = deltaY;
		R.delta = 0;
	} else {
		R.delta = deltaY;
		L.delta = 0;
	}
}

function applyRatioDelta() {
	const apply = (sc) => {
		if (sc.delta === 0) return;
		const px = sc.bounds.max > 0 ? 1 / sc.bounds.max : 0;
		sc.yRatio += sc.delta * px;
		sc.yRatio = Math.min(1, Math.max(0, sc.yRatio));
		sc.delta = 0;
	};
	apply(leftScroll);
	apply(rightScroll);
}

function tweenYToTarget(sc) {
	const target = sc.yRatio * sc.bounds.max;
	if (sc.scrollEase < 0.01) {
		sc.y = target;
		return;
	}
	if (quickYLeft && quickYRight) {
		if (sc === leftScroll) quickYLeft(target);
		else quickYRight(target);
	} else {
		gsap.to(sc, {
			y: target,
			duration: sc.scrollEase,
			ease: 'expo.out',
			overwrite: 'auto'
		});
	}
}

function setupScrollAdapter(track, sc) {
	const ro = new ResizeObserver((entries) => {
		const { height } = entries[0].contentRect;
		sc.bounds.max = Math.max(0, height - window.innerHeight + BOUNDS_PAD);
		sc.bounds.min = 0;
		tweenYToTarget(sc);
	});
	ro.observe(track);
}

function changeSide(side) {
	gsap.killTweensOf(ratioProxy);
	state.ratio = side === 'left' ? 0 : 1;
	state.ratioMouseTarget = state.ratio;
}

const easeInOut = gsap.parseEase('expo.inOut');

function onMouseMove(e) {
	if (!isSplit() || !site) return;
	const windowWidth = window.innerWidth;
	const padding = 0.5 - PADDING_RATIO;
	const totalSize = windowWidth * padding * 2;
	const delta = windowWidth - totalSize;
	const clientX = e.clientX - delta / 2;
	const t = Math.min(1, Math.max(0, clientX / totalSize));
	state.ratioMouseTarget = easeInOut(1 - t);
}

function onEnterWindow() {
	gsap.killTweensOf(ratioProxy);
	state.ratioLeaveTween = false;
}

function onLeaveWindow() {
	if (!isSplit()) return;
	state.ratioMouseTarget = 0.5;
	state.ratioLeaveTween = true;
	ratioProxy.ratio = state.ratio;
	gsap.to(ratioProxy, {
		ratio: 0.5,
		duration: 1,
		ease: 'expo.inOut',
		onUpdate: () => {
			state.ratio = ratioProxy.ratio;
		},
		onComplete: () => {
			state.ratioLeaveTween = false;
		}
	});
}

function onWheel(e) {
	if (!isSplit()) return;
	e.preventDefault();

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
	if (downPosX / window.innerWidth > 0.5) changeSide('left');
	else changeSide('right');
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
		window.addEventListener('wheel', onWheel, { passive: false });
		window.addEventListener('touchstart', onDown, { passive: false });
		window.addEventListener('touchend', onUp, { passive: false });
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

function syncSplitMode() {
	const split = isSplit();
	bindSplitListeners(split);
	bindSitePointer(split);
	if (split) {
		state.initialWheel = true;
	} else {
		leftScroll.y = 0;
		rightScroll.y = 0;
		leftCol.style.transform = '';
		rightCol.style.transform = '';
		leftCol.style.transformOrigin = '';
		rightCol.style.transformOrigin = '';
		leftTrack.style.gap = '';
		rightTrack.style.gap = '';
	}
}

function init() {
	if (typeof gsap === 'undefined') {
		console.error('GSAP not loaded');
		return;
	}

	if (typeof gsap.quickTo === 'function') {
		quickYLeft = gsap.quickTo(leftScroll, 'y', {
			duration: SCROLL_EASE,
			ease: 'expo.out'
		});
		quickYRight = gsap.quickTo(rightScroll, 'y', {
			duration: SCROLL_EASE,
			ease: 'expo.out'
		});
	}

	ratioProxy.ratio = 0.5;

	setupScrollAdapter(leftTrack, leftScroll);
	setupScrollAdapter(rightTrack, rightScroll);

	window.addEventListener('resize', syncSplitMode);

	syncSplitMode();

	function tick() {
		if (isSplit()) {
			// Never addDelta(0): addDelta overwrites left/right .delta and would erase
			// pending wheel delta before applyRatioDelta runs.
			if (state.splitListenersBound) {
				if (state.isDown) {
					state.speed *= 0.7;
				} else {
					if (Math.abs(state.speed) > 1e-6) {
						addDelta(state.speed);
					}
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

			const offL =
				(halfH - halfH * leftScale) * (leftScroll.yRatio * 2 - 1);
			const offR =
				(halfH - halfH * rightScale) * (rightScroll.yRatio * 2 - 1);

			const tyL = -leftScroll.y + offL;
			const tyR = -rightScroll.y + offR;

			leftCol.style.transformOrigin = `0px ${originLeft}px`;
			rightCol.style.transformOrigin = `0px ${originRight}px`;

			leftCol.style.transform = `translate3d(${leftX}px, ${tyL}px, 0) scale(${leftScale})`;
			rightCol.style.transform = `translate3d(${rightX}px, ${tyR}px, 0) scale(${rightScale})`;

			leftTrack.style.gap = `${PADDING / leftScale}px`;
			rightTrack.style.gap = `${PADDING / rightScale}px`;
		}

		requestAnimationFrame(tick);
	}

	requestAnimationFrame(tick);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

const cursorFollow = document.getElementById('cursor-follow');
if (cursorFollow) {
	let cursorX = 0, cursorY = 0, targetX = 0, targetY = 0;
	let isOver = false;

	document.addEventListener('mousemove', (e) => {
		targetX = e.clientX;
		targetY = e.clientY;
		const el = document.elementFromPoint(e.clientX, e.clientY);
		const onGallery = el && el.closest('.case .gallery');
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
		cursorFollow.style.left = cursorX + 'px';
		cursorFollow.style.top = cursorY + 'px';
		requestAnimationFrame(animateCursor);
	}
	animateCursor();
}

const introVideo = document.getElementById('intro-video');
if (introVideo) {
	let videoPlaying = false;
	document.addEventListener('mousemove', (e) => {
		const onRight = e.clientX > window.innerWidth / 2;
		if (onRight && !videoPlaying) {
			introVideo.play();
			videoPlaying = true;
		} else if (!onRight && videoPlaying) {
			introVideo.pause();
			videoPlaying = false;
		}
	});
}

document.querySelectorAll('.case').forEach((caseEl) => {
	const track = caseEl.querySelector('.gallery-track');
	const slides = caseEl.querySelectorAll('.slide');
	const prevBtn = caseEl.querySelector('.arrow.prev');
	const nextBtn = caseEl.querySelector('.arrow.next');
	const curEl = caseEl.querySelector('.pagination .cur');
	const total = slides.length;
	let index = 0;

	const render = () => {
		track.style.transform = `translateX(${-index * 100}%)`;
		if (curEl) curEl.textContent = String(index + 1).padStart(2, '0');
	};
	const go = (dir) => {
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

	const gallery = caseEl.querySelector('.gallery');
	const href = caseEl.getAttribute('data-href');

	let touchStartX = 0;
	let touchStartY = 0;
	let swiped = false;

	if (gallery) {
		gallery.addEventListener('touchstart', (e) => {
			touchStartX = e.touches[0].clientX;
			touchStartY = e.touches[0].clientY;
			swiped = false;
		}, { passive: true });

		gallery.addEventListener('touchmove', (e) => {
			const dx = e.touches[0].clientX - touchStartX;
			const dy = e.touches[0].clientY - touchStartY;
			if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
				swiped = true;
			}
		}, { passive: true });

		gallery.addEventListener('touchend', (e) => {
			const dx = e.changedTouches[0].clientX - touchStartX;
			if (swiped) {
				if (dx < -30) go(1);
				else if (dx > 30) go(-1);
				return;
			}
			if (href) {
				document.body.style.transition = 'opacity 1.2s cubic-bezier(0.4, 0, 0.2, 1), transform 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
				document.body.style.opacity = '0';
				document.body.style.transform = 'scale(0.98)';
				setTimeout(() => { window.location.href = href; }, 1000);
			}
		});
	}

	if (gallery && href) {
		gallery.addEventListener('click', (e) => {
			if (e.target.closest('.arrow')) return;
			if (swiped) return;
			e.preventDefault();
			document.body.style.transition = 'opacity 1.2s cubic-bezier(0.4, 0, 0.2, 1), transform 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
			document.body.style.opacity = '0';
			document.body.style.transform = 'scale(0.98)';
			setTimeout(() => { window.location.href = href; }, 1000);
		});
		gallery.style.cursor = 'pointer';
	}

	render();
});

document.querySelectorAll('.accordion-container').forEach((ac) => {
	const btn = ac.querySelector('.read-more');
	const content = ac.querySelector('.content');
	if (!btn || !content) return;

	btn.innerHTML = '<span class="line"></span><span class="line"></span>';
	const lines = btn.querySelectorAll('.line');
	const line1 = lines[0];
	const line2 = lines[1];

	let isOpen = false;
	let tweening = false;
	const proxy = { ratio: 0 };

	const PAD_TOP_BASE = 16;
	const PAD_TOP_EXTRA = 18;
	const PAD_BOT_BASE = 32;

	function applyRatio(r) {
		const totalH = content.scrollHeight;
		if (r >= 1) {
			content.style.height = 'auto';
		} else if (r <= 0) {
			content.style.height = '0';
		} else {
			content.style.height = Math.round(r * totalH) + 'px';
		}
		ac.style.paddingTop = (PAD_TOP_BASE + PAD_TOP_EXTRA * r) + 'px';
		ac.style.paddingBottom = PAD_BOT_BASE + 'px';

		line1.style.transform = `rotate(${180 * (1 - r)}deg)`;
		line2.style.transform = `rotate(${90 * (1 - r)}deg)`;
	}

	applyRatio(0);

	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (tweening) return;
		isOpen = !isOpen;
		tweening = true;
		gsap.to(proxy, {
			ratio: isOpen ? 1 : 0,
			duration: 1,
			ease: 'expo.inOut',
			onUpdate: () => applyRatio(proxy.ratio),
			onComplete: () => { tweening = false; }
		});
	});
});

document.addEventListener('keydown', (e) => {
	if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
	const cases = Array.from(document.querySelectorAll('.case'));
	const vh = window.innerHeight;
	let best = null;
	let bestDist = Infinity;
	cases.forEach((c) => {
		const r = c.getBoundingClientRect();
		const center = r.top + r.height / 2;
		const d = Math.abs(center - vh / 2);
		if (d < bestDist) {
			bestDist = d;
			best = c;
		}
	});
	const btn =
		e.key === 'ArrowLeft'
			? best?.querySelector('.arrow.prev')
			: best?.querySelector('.arrow.next');
	btn?.click();
});

const mobileTabs = document.querySelectorAll('.mobile-tab');
const colLeft = document.querySelector('.col-left');
const colRightEl = document.querySelector('.col-right');
mobileTabs.forEach(tab => {
	tab.addEventListener('click', () => {
		mobileTabs.forEach(t => t.classList.remove('active'));
		tab.classList.add('active');
		const target = tab.getAttribute('data-target');
		if (target === 'left') {
			colLeft.classList.remove('hidden');
			colRightEl.classList.remove('visible');
		} else {
			colLeft.classList.add('hidden');
			colRightEl.classList.add('visible');
		}
		window.scrollTo(0, 0);
	});
});

const clockEl = document.getElementById('msk-clock');
if (clockEl) {
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
