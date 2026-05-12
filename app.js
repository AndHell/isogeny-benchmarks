const { createApp, ref, computed, onMounted } = Vue

createApp({
    setup() {
        // ── Data ──
        const nikeData = ref([])
        const sigData = ref([])

        // ── UI state ──
        const schemeTab    = ref('nike')
        const nikeTab       = ref('all')
        const sigTab       = ref('all')
        const isDark       = ref(false)
        const showDetails  = ref(false)
        const altWeights   = ref(false)
        const modal        = ref(null)

        const nikeFiltersOpen = ref(true)
        const sigFiltersOpen = ref(true)

        const nikeSortKey = ref('paper')
        const nikeSortDir = ref('asc')
        const sigSortKey = ref('paper')
        const sigSortDir = ref('asc')

        // ── Filter state ──
        const nf = ref({ schemes:[], sizes:[], keyspaces:[], platforms:[], constantTime:null, deterministic:null, dummyFree:null })
        const sf = ref({ schemes:[], nistLevels:[], platforms:[], constantTime:null, deterministic:null, dummyFree:null })

        // ══ NIKE computed ══
        const nikePapersWithBenchmarks = computed(() =>
            nikeData.value.filter(p => p.benchmarks?.length).sort((a,b) => new Date(a.date)-new Date(b.date))
        )

        const allNikeBenchmarks = computed(() => {
            const list = []
            nikePapersWithBenchmarks.value.forEach((paper,pi) =>
                paper.benchmarks.forEach((b,bi) => list.push({...b, paper, _uid:`k-${pi}-${bi}`}))
            )
            return list
        })

        const nikeUniqueSchemes   = computed(() => [...new Set(nikeData.value.map(p=>p.scheme).filter(Boolean))].sort())
        const nikeUniqueSizes     = computed(() => [...new Set(allNikeBenchmarks.value.map(b=>b.size))].sort((a,b)=>a-b))
        const nikeUniqueKeyspaces = computed(() => [...new Set(allNikeBenchmarks.value.map(b=>b.keyspace))].sort((a,b)=>a-b))
        const nikeUniquePlatforms = computed(() => [...new Set(allNikeBenchmarks.value.flatMap(b=>(b.cycles||[]).map(c=>c.platform)))].sort())

        const nikeActiveFilterCount = computed(() => {
            let n = nf.value.schemes.length + nf.value.sizes.length + nf.value.keyspaces.length + nf.value.platforms.length
            if (nf.value.constantTime!==null)  n++
            if (nf.value.deterministic!==null) n++
            if (nf.value.dummyFree!==null)     n++
            return n
        })

        function wt()       { return altWeights.value ? {M:1,S:.85,a:.15} : {M:1,S:1,a:0} }
        function rawOps(b)  { const o=b.operations; if(!o) return 0; const w=wt(); return o.M*w.M+o.S*w.S+o.a*w.a }
        function weightedOps(ops) { if(!ops) return '—'; const w=wt(); return Math.round(ops.M*w.M+ops.S*w.S+ops.a*w.a).toLocaleString() }
        function opsTooltip(ops)  { if(!ops) return ''; return `M=${ops.M.toLocaleString()}, S=${ops.S.toLocaleString()}, a=${ops.a.toLocaleString()}` }

        const filteredNikeBenchmarks = computed(() => {
            let list = allNikeBenchmarks.value
            if (nf.value.schemes.length)    list = list.filter(b => nf.value.schemes.includes(b.paper.scheme))
            if (nf.value.sizes.length)      list = list.filter(b => nf.value.sizes.includes(b.size))
            if (nf.value.keyspaces.length)  list = list.filter(b => nf.value.keyspaces.includes(b.keyspace))
            if (nf.value.platforms.length)  list = list.filter(b => b.cycles?.some(c => nf.value.platforms.includes(c.platform)))
            if (nf.value.constantTime!==null)  list = list.filter(b => b.constant_time===nf.value.constantTime)
            if (nf.value.deterministic!==null) list = list.filter(b => b.deterministic===nf.value.deterministic)
            if (nf.value.dummyFree!==null)     list = list.filter(b => b.dummy_free===nf.value.dummyFree)
            return [...list].sort((a,b) => {
                let va, vb
                if      (nikeSortKey.value==='paper')  { va=new Date(a.paper.date); vb=new Date(b.paper.date) }
                else if (nikeSortKey.value==='size')   { va=a.size;    vb=b.size }
                else if (nikeSortKey.value==='ops')    { va=rawOps(a); vb=rawOps(b) }
                else if (nikeSortKey.value==='cycles') { va=a.cycles?.[0]?.value??0; vb=b.cycles?.[0]?.value??0 }
                else return 0
                return nikeSortDir.value==='asc' ? (va>vb?1:va<vb?-1:0) : (va<vb?1:va>vb?-1:0)
            })
        })

        // ══ Signature computed ══
        const sigPapersWithBenchmarks = computed(() =>
            sigData.value.filter(p => p.benchmarks?.length).sort((a,b) => new Date(a.date)-new Date(b.date))
        )

        const allSigBenchmarks = computed(() => {
            const list = []
            sigPapersWithBenchmarks.value.forEach((paper,pi) =>
                paper.benchmarks.forEach((b,bi) => list.push({...b, paper, _uid:`s-${pi}-${bi}`}))
            )
            return list
        })

        const sigUniqueSchemes    = computed(() => [...new Set(sigData.value.map(p=>p.scheme).filter(Boolean))].sort())
        const sigUniqueNistLevels = computed(() => [...new Set(allSigBenchmarks.value.map(b=>b.nist_level))].sort((a,b)=>a-b))
        const sigUniquePlatforms  = computed(() => [...new Set(allSigBenchmarks.value.flatMap(b=>(b.cycles||[]).map(c=>c.platform)))].sort())

        const sigActiveFilterCount = computed(() => {
            let n = sf.value.schemes.length + sf.value.nistLevels.length + sf.value.platforms.length
            if (sf.value.constantTime!==null)  n++
            if (sf.value.deterministic!==null) n++
            if (sf.value.dummyFree!==null)     n++
            return n
        })

        function sigCycleVal(b, op) {
            const c = b.cycles?.[0]
            return c?.[op]?.value ?? 0
        }

        const filteredSigBenchmarks = computed(() => {
            let list = allSigBenchmarks.value
            if (sf.value.schemes.length)     list = list.filter(b => sf.value.schemes.includes(b.paper.scheme))
            if (sf.value.nistLevels.length)  list = list.filter(b => sf.value.nistLevels.includes(b.nist_level))
            if (sf.value.platforms.length)   list = list.filter(b => b.cycles?.some(c => sf.value.platforms.includes(c.platform)))
            if (sf.value.constantTime!==null)  list = list.filter(b => b.constant_time===sf.value.constantTime)
            if (sf.value.deterministic!==null) list = list.filter(b => b.deterministic===sf.value.deterministic)
            if (sf.value.dummyFree!==null)     list = list.filter(b => b.dummy_free===sf.value.dummyFree)
            return [...list].sort((a,b) => {
                let va, vb
                if      (sigSortKey.value==='paper')  { va=new Date(a.paper.date); vb=new Date(b.paper.date) }
                else if (sigSortKey.value==='sig')    { va=a.sig_size;  vb=b.sig_size }
                else if (sigSortKey.value==='pk')     { va=a.pk_size;   vb=b.pk_size }
                else if (sigSortKey.value==='sk')     { va=a.sk_size;   vb=b.sk_size }
                else if (sigSortKey.value==='keygen') { va=sigCycleVal(a,'keygen'); vb=sigCycleVal(b,'keygen') }
                else if (sigSortKey.value==='sign')   { va=sigCycleVal(a,'sign');   vb=sigCycleVal(b,'sign') }
                else if (sigSortKey.value==='verify') { va=sigCycleVal(a,'verify'); vb=sigCycleVal(b,'verify') }
                else return 0
                return sigSortDir.value==='asc' ? (va>vb?1:va<vb?-1:0) : (va<vb?1:va>vb?-1:0)
            })
        })

        // ══ Actions ══
        function setNikeSort(key) {
            nikeSortDir.value = nikeSortKey.value===key ? (nikeSortDir.value==='asc'?'desc':'asc') : 'asc'
            nikeSortKey.value = key
        }
        function setSigSort(key) {
            sigSortDir.value = sigSortKey.value===key ? (sigSortDir.value==='asc'?'desc':'asc') : 'asc'
            sigSortKey.value = key
        }
        function toggleArr(obj, field, val) {
            const i = obj[field].indexOf(val)
            i===-1 ? obj[field].push(val) : obj[field].splice(i,1)
        }
        function toggleBool(obj, field, val) { obj[field] = obj[field]===val ? null : val }
        function clearNikeFilters() { nf.value = {schemes:[],sizes:[],keyspaces:[],platforms:[],constantTime:null,deterministic:null,dummyFree:null} }
        function clearSigFilters() { sf.value = {schemes:[],nistLevels:[],platforms:[],constantTime:null,deterministic:null,dummyFree:null} }

        function setSchemeTab(tab) {
            schemeTab.value = tab
            window.location.hash = tab
        }

        function toggleTheme() {
            isDark.value = !isDark.value
            document.documentElement.setAttribute('data-theme', isDark.value?'dark':'light')
            localStorage.setItem('theme', isDark.value?'dark':'light')
        }
        function openModal(paper) { modal.value = paper }
        function fmtDate(d)       { return d ? new Date(d).toLocaleString('default',{month:'short',year:'numeric'}) : '' }
        function firstAuthor(s)   { if(!s) return ''; const p=s.split(','); return p[0].trim()+(p.length>1?' et al.':'') }

        onMounted(async () => {
            const saved = localStorage.getItem('theme')
            isDark.value = saved ? saved==='dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
            document.documentElement.setAttribute('data-theme', isDark.value?'dark':'light')
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
                if (!localStorage.getItem('theme')) {
                    isDark.value = e.matches
                    document.documentElement.setAttribute('data-theme', isDark.value?'dark':'light')
                }
            })

            // Read tab from URL hash on load
            const hash = window.location.hash.replace('#', '')
            if (hash === 'sig' || hash === 'nike') schemeTab.value = hash

            // Keep tab in sync with browser back/forward
            window.addEventListener('hashchange', () => {
                const h = window.location.hash.replace('#', '')
                if (h === 'sig' || h === 'nike') schemeTab.value = h
            })
            try { const r = await fetch('isogeny_data.json');    nikeData.value = await r.json() } catch(e) { console.error('NIKE data failed:', e) }
            try { const r = await fetch('signatures_data.json'); sigData.value = await r.json() } catch(e) { console.error('Sig data failed:', e) }
        })

        return {
            schemeTab, nikeTab, sigTab, isDark, showDetails, altWeights, modal,
            nikeFiltersOpen, sigFiltersOpen,
            nikeSortKey, nikeSortDir, sigSortKey, sigSortDir,
            nf, sf,
            nikePapersWithBenchmarks, sigPapersWithBenchmarks,
            filteredNikeBenchmarks, filteredSigBenchmarks,
            nikeUniqueSchemes, nikeUniqueSizes, nikeUniqueKeyspaces, nikeUniquePlatforms, nikeActiveFilterCount,
            sigUniqueSchemes, sigUniqueNistLevels, sigUniquePlatforms, sigActiveFilterCount,
            weightedOps, opsTooltip,
            setNikeSort, setSigSort, toggleArr, toggleBool,
            clearNikeFilters, clearSigFilters,
            setSchemeTab, toggleTheme, openModal, fmtDate, firstAuthor
        }
    }
}).mount('#app')
