export const TABLE_HTML = [
  '<table>',
  '<caption>Scores</caption>',
  '<colgroup><col></colgroup>',
  '<thead><tr><th colspan="2" scope="col">H</th></tr></thead>',
  '<tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody>',
  '<tfoot><tr><td colspan="2">T</td></tr></tfoot>',
  '</table>',
].join('');

export const RICH_HTML = [
  '<pre><code>const x = 1;</code></pre>',
  '<blockquote>quoted</blockquote>',
  '<ul><li>one</li></ul>',
  '<ol start="3" reversed><li value="9">nine</li></ol>',
  '<dl><dt>Term</dt><dd>Def</dd></dl>',
  '<p>H<sub>2</sub>O <sup>n</sup> <mark>hit</mark> <kbd>Ctrl</kbd> <del>old</del> <ins>new</ins></p>',
  '<details open><summary>More</summary><p>body</p></details>',
  '<p><abbr title="HyperText Markup Language">HTML</abbr> <q>quote</q> <cite>src</cite> <small>fine</small></p>',
  '<p><time datetime="2026-01-02">Jan 2</time></p>',
].join('');

export const WECHAT_HTML = `<section><section>
  <span><br></span>
  <p><span><br></span></p>
  <p><span>正文第一段。</span></p>
  <p><span><br></span></p>
  <section><img src="" data-src="https://mmbiz.qpic.cn/lazy.jpg" alt=""></section>
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="">
  <i></i>
  <ul></ul>
  <section><img src="https://mmbiz.qpic.cn/hero.jpg" alt="图"></section>
  <p>已关注</p>
  <i></i>
  关注
  <i></i>
  重播 分享 赞 关闭
  <strong>观看更多</strong>
  大淘宝技术已关注分享视频，时长00:16
  <p>0/0</p>
  您的浏览器不支持 video 标签
  <p>继续观看</p>
  <p>0.5倍 1.0倍 倍速</p>
  <p>正文第二段。</p>
</section></section>`;

export const MALICIOUS_HTML = [
  '<p>safe</p>',
  '<script>alert(1)</script>',
  '<a href="javascript:alert(1)">x</a>',
  '<p onclick="alert(1)" onmouseover="alert(2)" style="color:red" class="x">hi</p>',
  '<img src="javascript:alert(1)" onerror="alert(1)">',
  '<img src="data:image/gif;base64,xx" alt="d">',
  '<svg onload="alert(1)"><script>alert(1)</script><text>svgtext</text></svg>',
  '<iframe src="https://evil.test"></iframe>',
  '<a href="data:text/html,y">y</a>',
].join('');

export const VOCABULARY_HTML = [
  '<a href="https://e.test/a">a</a>',
  '<p>p<br><span>span</span></p>',
  '<div>div</div>',
  '<strong>strong</strong><em>em</em><b>b</b><i>i</i><u>u</u><s>s</s>',
  '<blockquote>quote</blockquote>',
  '<ul><li>ul</li></ul>',
  '<ol start="3" reversed><li value="9">ol</li></ol>',
  '<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>',
  '<pre><code>code</code></pre>',
  '<img src="https://e.test/a.png" alt="x" title="t" width="1" height="1">',
  '<figure><figcaption>cap</figcaption></figure>',
  '<hr>',
  '<video src="https://e.test/a.mp4" poster="https://e.test/p.jpg" controls playsinline width="1" height="1">',
  '<source src="https://e.test/a.mp4" type="video/mp4">',
  '</video>',
  '<table>',
  '<caption>cap</caption>',
  '<colgroup><col></colgroup>',
  '<thead><tr><th colspan="2" scope="col">h</th></tr></thead>',
  '<tbody><tr><td rowspan="1">d</td></tr></tbody>',
  '<tfoot><tr><td>f</td></tr></tfoot>',
  '</table>',
  '<dl><dt>dt</dt><dd>dd</dd></dl>',
  '<p><sup>p</sup><sub>b</sub><mark>m</mark><kbd>k</kbd><abbr title="x">ab</abbr></p>',
  '<p><del>d</del><ins>i</ins><q>q</q><cite>c</cite></p>',
  '<p><time datetime="2026-01-02">t</time></p>',
  '<details open><summary>s</summary>body</details>',
  '<picture><source src="https://e.test/a.jpg" type="image/jpeg"><img src="https://e.test/a.jpg" alt="p"></picture>',
  '<small>small</small>',
].join('');

export const PROTOCOL_RELATIVE_HTML =
  '<a href="//evil.test/x">x</a><img src="//evil.test/a.png" alt="x">';
