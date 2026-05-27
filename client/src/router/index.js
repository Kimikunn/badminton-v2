import { createRouter, createWebHistory } from 'vue-router'

// 首屏静态导入
import HomeView from '@/views/HomeView.vue'

// 动态导入（代码分割）
const ScoringView = () => import('@/views/ScoringView.vue')
const SeasonOverview = () => import('@/views/SeasonOverview.vue')
const SeasonRounds = () => import('@/views/SeasonRounds.vue')
const SeasonRankings = () => import('@/views/SeasonRankings.vue')
const RuleDashboard = () => import('@/views/RuleDashboard.vue')
const MatchHubView = () => import('@/views/MatchHubView.vue')
const MatchDetailView = () => import('@/views/MatchDetailView.vue')
const PlayerDetailView = () => import('@/views/PlayerDetailView.vue')
const VenueView = () => import('@/views/VenueView.vue')
const RankingsHubView = () => import('@/views/RankingsHubView.vue')

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
    meta: { title: 'The Plume Championship', tab: 'home', depth: 0 }
  },
  {
    path: '/scoring/:matchId',
    name: 'scoring',
    component: ScoringView,
    meta: { title: '记分', hideTab: true, depth: 2 }
  },
  {
    path: '/season',
    redirect: '/season/overview'
  },
  {
    path: '/season/overview',
    name: 'season-overview',
    component: SeasonOverview,
    meta: { title: '赛季概览', tab: 'season', depth: 0 }
  },
  {
    path: '/season/rounds',
    name: 'season-rounds',
    component: SeasonRounds,
    meta: { title: '轮次记录', tab: 'season', depth: 0 }
  },
  {
    path: '/season/rankings',
    name: 'season-rankings',
    component: SeasonRankings,
    meta: { title: '积分榜', tab: 'season', depth: 0 }
  },
  {
    path: '/season/rules',
    name: 'rule-dashboard',
    component: RuleDashboard,
    meta: { title: '规则面板', tab: 'season', depth: 0 }
  },
  {
    path: '/matches',
    name: 'matches',
    component: MatchHubView,
    meta: { title: '比赛', tab: 'matches', depth: 0 }
  },
  {
    path: '/rankings',
    name: 'rankings',
    component: RankingsHubView,
    meta: { title: '积分榜', tab: 'rankings', depth: 0 }
  },
  {
    path: '/matches/:id',
    name: 'match-detail',
    component: MatchDetailView,
    meta: { title: '比赛详情', hideTab: true, depth: 1 }
  },
  {
    path: '/club',
    redirect: '/venues'
  },
  {
    path: '/players/:id',
    name: 'player-detail',
    component: PlayerDetailView,
    meta: { title: '选手详情', hideTab: true, depth: 1 }
  },
  {
    path: '/venues',
    name: 'venues',
    component: VenueView,
    meta: { title: '场地', tab: 'venues', depth: 0 }
  }
]

const router = createRouter({
  history: createWebHistory('/'),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0 }
  }
})

export default router
