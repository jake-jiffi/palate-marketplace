#!/usr/bin/env node
/**
 * paired-grade.mjs - does a build this plugin approves actually score well in the public grader?
 *
 * The claim the whole plugin-vs-grader convergence rests on, measured rather than asserted. It
 * scores a list of URLs on the eight deterministic checks the plugin and the grader now SHARE
 * (design-measure.mjs + vitals.mjs, both hash-pinned in both repos), and reports the median and
 * the failing-check count per population.
 *
 * It deliberately does NOT include the vision ladder or the taste head. Those are the grader's
 * strongest signals and the plugin has no access to them, so including them would measure the
 * grader against itself. What this answers is narrower and checkable: on everything both sides
 * can see, does a Palate build clear the bar.
 *
 * Usage:
 *   node paired-grade.mjs                       # the built-in Palate demo set vs ordinary sites
 *   node paired-grade.mjs --a <url,url> --b <url,url>
 *
 * Run 2026-08-06, 8 Palate demos vs 11 reachable ordinary small-business sites (plumbers,
 * dentists, trades directories, a bakery: the population the grader actually receives):
 *   PALATE    n=8   median 0.93   0.3 failing checks per site   6 of 8 with none
 *   ordinary  n=11  median 0.68   1.6 failing checks per site   1 of 11 with none
 *
 * The ordinary set is NOT uniformly bad, which is what makes the comparison worth anything:
 * smilegeneration.com scores 0.92 with no failing check. A gate that failed every site outside
 * our own would be measuring nothing.
 *
 * THE COMPARISON IS PARTLY CONFOUNDED, AND THIS WAS MEASURED RATHER THAN CONCEDED. The two
 * populations are not the same size of thing. Medians:
 *
 *              DOM nodes  controls  media  internal routes  page height
 *   PALATE           234        29      1               10       5375px
 *   ordinary        1508       174     44               59       5637px
 *
 * Six times the nodes, six times the controls, forty-four times the media. Only scroll height
 * is comparable. So the headline gap is NOT clean evidence that Palate builds are better: some
 * of it is that they are smaller, and a page with one image will beat a page with forty-four
 * on LCP whoever built it.
 *
 * The split that survives the confound:
 *   MOSTLY FAIR    colour_accent_discipline and type_system_discipline - a framework-default
 *                  accent is a framework default at any page size, and so is a default-only
 *                  type stack. responsive_integrity too, since it scores the SHARE of controls
 *                  under 24px rather than the count, which is why it was normalised.
 *   CONFOUNDED     lcp, cls, responsiveness, js_execution_and_payload. These scale with how
 *                  much a page carries, and the ordinary set carries far more.
 *
 * THE SURVIVING HALF IS NOW MEASURED, NOT ARGUED. Splitting the checks by whether they should
 * be complexity-independent was reasoning; testing it was one more run. Pearson r between DOM
 * node count and each design check, across the ordinary population spanning 5 to 15,510 nodes:
 *
 *   colour_accent_discipline   r = +0.18
 *   type_system_discipline     r = -0.01
 *   responsive_integrity       r = +0.19
 *
 * All near zero, and if anything faintly POSITIVE, so bigger pages do not score worse on these.
 * The three checks measure craft rather than size, which is what the split claimed and had not
 * shown.
 *
 * THE VITALS CONFOUND IS REAL BUT MODERATE, and "no correlation test rescues them" was lazier
 * than measuring it. Pearson r between media-element count and each vitals check across the
 * ordinary population, spanning 0 to 146 media elements:
 *
 *   lcp             r = -0.33   (r-squared 0.11)
 *   cls             r = -0.27   (0.07)
 *   responsiveness  r = -0.56   (0.31)
 *   js payload      r = -0.35   (0.12)
 *
 * All negative, so carrying more genuinely costs a page and the confound is confirmed.
 *
 * AND THEN THE CONTROL WAS RUN, AND THE VITALS ADVANTAGE DID NOT SURVIVE IT. Regressing the
 * mean vitals score on population while controlling for log media count (Frisch-Waugh-Lovell,
 * n=19, median media 2 for Palate against 45 for ordinary):
 *
 *   raw vitals gap                  0.329
 *   controlling for log(media)      0.120   se 0.093, t = 1.30
 *   share of the raw gap surviving  36%
 *
 * t = 1.30 at n=19 is not significant. So roughly two thirds of the vitals gap is page weight,
 * and what remains cannot be distinguished from zero on this sample. THE VITALS HALF OF THE
 * PAIRED RESULT IS NOT EVIDENCE THAT PALATE BUILDS ARE FASTER. It is mostly evidence that they
 * are lighter, which they are, and which is not the same claim.
 *
 * The design half is the opposite and survives on its own terms: r ~ 0 against page size across
 * 5 to 15,510 nodes, so those checks measure craft rather than weight. * BOTH HALVES WERE THEN PUT THROUGH THE SAME CONTROL, AND THE HONEST ANSWER IS MODEST:
 *
 *                        raw gap   controlled   survives      t
 *   design checks          0.089      0.096       107%       1.60
 *   vitals checks          0.329      0.120        36%       1.30
 *
 * NEITHER REACHES SIGNIFICANCE AT n=19 (t would need about 2.1). The qualitative difference
 * between them is real and is the part worth carrying: the design gap SURVIVES controlling for
 * page weight and is if anything slightly larger once you do, while two thirds of the vitals
 * gap simply is page weight. But "survives the control" is not "is proven", and this sample
 * cannot carry the claim that plugin-approved builds score better. It can only say the design
 * difference is not an artefact of size, which is a much smaller statement.
 *
 * THE BINARY WAS THEN TESTED PROPERLY, AND IT DOES NOT RESCUE THE CLAIM EITHER. Fisher exact
 * on the zero-failing-check contrast:
 *
 *   ALL checks     Palate 6/8 vs ordinary 1/11    p = 0.006   significant, odds ratio 30
 *   DESIGN only    Palate 7/8 vs ordinary 8/11    p = 0.603   no separation at all
 *
 * The significant result is carried ENTIRELY by vitals failures, which are the confounded half:
 * strip them out and the binary separates no better than chance. So the one statistically
 * significant finding in this whole comparison rests on the measurement we already showed is
 * two thirds page weight.
 *
 * THE HONEST BOTTOM LINE: this data does not support the claim that plugin-approved builds
 * score better in the grader. It supports the claim that they are LIGHTER. Those coincide often
 * enough to be easy to confuse, and confusing them is how a product ends up believing its own
 * marketing. The instrument is sound; the claim about what it shows is not yet earned.
 *
 * What would settle it: more builds on both sides, and a real trading business's site rebuilt
 * at real weight and re-graded against its own baseline. That last one is the only design that
 * removes the confound rather than adjusting for it.
 */
import {chromium} from 'playwright';
import {measurePage, scoreDesignFacts} from './design-measure.mjs';
import {measureVitals, scoreVitals} from './vitals.mjs';
const b=await chromium.launch({headless:true,channel:'chromium',args:['--no-sandbox','--disable-gpu']});
async function full(url){
  const facts={};
  try{
    for(const [n,vp] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
      const c=await b.newContext({viewport:vp}); const p=await c.newPage();
      await p.goto(url,{waitUntil:'load',timeout:35000});
      await p.evaluate(()=>new Promise(r=>setTimeout(r,1100)));
      await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
      await p.evaluate(()=>new Promise(r=>setTimeout(r,600)));
      facts[n]=await measurePage(p); await c.close();
    }
    const vc=await b.newContext({viewport:{width:390,height:844}});
    const v=await measureVitals(await vc.newPage(),url); await vc.close();
    const all=[...scoreDesignFacts(facts),...scoreVitals(v)].filter(c=>c.raw!==null);
    if(!all.length) return null;
    return {avg:all.reduce((a,c)=>a+c.raw,0)/all.length,n:all.length,
      fails:all.filter(c=>c.raw<0.5).map(c=>c.id)};
  }catch(e){return null;}
}
const PALATE=['https://aralia-skincare.vercel.app','https://aught-site.vercel.app','https://axis-object.vercel.app',
  'https://hesper-retreat.vercel.app','https://kern-foundry.vercel.app','https://nocturne-label.vercel.app',
  'https://vela-analytics.vercel.app','https://zoop-soda.vercel.app'];
// Real small-business sites of the kind the grader actually receives: the population the
// product is sold against, not flagship marketing pages.
const ORDINARY=['https://shortysplumbingllc.com','https://neptuneplumbing.net','https://localplumbercolumbus.com',
  'https://www.mrrooter.com','https://www.rotorooter.com','https://www.aptdental.com',
  'https://www.gentledental.com','https://www.smilegeneration.com','https://www.jimsmowing.com.au',
  'https://www.hipages.com.au','https://www.bakerdays.com'];
const rows=[];
for(const [k,list] of [['PALATE',PALATE],['ordinary',ORDINARY]]){
  for(const u of list){
    const r=await full(u);
    if(!r){console.log(k.padEnd(9)+'  --   unreachable  '+u);continue;}
    rows.push({k,u,...r});
    console.log(k.padEnd(9)+r.avg.toFixed(2)+'  '+String(r.fails.length)+' fail  '+u.replace('https://','')+(r.fails.length?'  ['+r.fails.join(',')+']':''));
  }
}
await b.close();
const g=k=>rows.filter(r=>r.k===k);
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
for(const k of ['PALATE','ordinary']){
  const s=g(k); if(!s.length) continue;
  console.log('\n'+k+'  n='+s.length+'  median '+med(s.map(r=>r.avg)).toFixed(2)
    +'  mean fails/site '+(s.reduce((a,r)=>a+r.fails.length,0)/s.length).toFixed(1)
    +'  sites with ZERO failing checks: '+s.filter(r=>!r.fails.length).length+'/'+s.length);
}
