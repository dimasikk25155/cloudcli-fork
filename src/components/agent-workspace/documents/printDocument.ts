/** Only text nodes enter the isolated print document; incoming HTML is never executed. */
export function printDocument(title:string,text:string){
 const popup=window.open('','_blank','width=900,height=700');
 if(!popup)throw new Error('Разрешите окно печати в браузере');
 popup.opener=null;popup.document.title=title;
 const heading=popup.document.createElement('h1');heading.textContent=title;
 const body=popup.document.createElement('pre');body.textContent=text;body.style.whiteSpace='pre-wrap';body.style.fontFamily='sans-serif';body.style.overflowWrap='anywhere';
 popup.document.body.replaceChildren(heading,body);popup.focus();popup.print();
}
