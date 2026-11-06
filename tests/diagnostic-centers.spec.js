import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
const id='12345678-1234-4234-8234-123456789012';
const staffId='12345678-1234-4234-8234-123456789013';
const centerId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01';
async function mock(page,role='diagnostic_staff',status='approved'){
 const user={id,aud:'authenticated',role:'authenticated',email:'staff@example.com',app_metadata:{},user_metadata:{},created_at:'2026-11-06T12:00:00Z'};
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.signature`;
 const center={id:centerId,name:'Central Diagnostics',approval_status:'approved'};
 const member={id:staffId,email:'newstaff@example.com',role:'diagnostic_staff',approval_status:'pending',diagnostic_center_id:null};
 await page.route('**/auth/v1/**',route=>route.fulfill({json:route.request().url().includes('/user')?user:route.request().url().includes('/logout')?{}:{access_token:token,refresh_token:'refresh',expires_in:3600,token_type:'bearer',user}}));
 await page.route('**/rest/v1/profiles*',route=>route.fulfill({json:route.request().url().includes('id=eq.')?{...user,role,approval_status:status,diagnostic_center_id:centerId}:[member]}));
 await page.route('**/rest/v1/pharmacies*',route=>route.fulfill({json:[]}));
 await page.route('**/rest/v1/diagnostic_centers*',route=>route.fulfill({json:route.request().url().includes('id=eq.')?center:[center]}));
 await page.route('**/rest/v1/rpc/paws_diagnostic_center_id',route=>route.fulfill({json:centerId}));
 return{user,token,center,member};
}
async function signIn(page){await page.goto('/');await page.getByLabel('Email',{exact:true}).fill('staff@example.com');await page.getByLabel('Password',{exact:true}).fill('Longer-password1!');await page.getByRole('button',{name:'Log In'}).click();}
test('admin adds a center, approves staff membership and suspends organization',async({page})=>{
 const{center,member}=await mock(page,'admin');const operations=[];
 await page.route('**/rest/v1/rpc/save_diagnostic_center',route=>{const args=route.request().postDataJSON();operations.push(args);if(args.decision)center.approval_status=args.decision;return route.fulfill({json:centerId});});
 await page.route('**/rest/v1/rpc/assign_diagnostic_center_member',route=>{operations.push(route.request().postDataJSON());member.approval_status='approved';member.diagnostic_center_id=centerId;return route.fulfill({json:null});});
 await signIn(page);await page.getByRole('button',{name:'Account',exact:true}).click();
 await page.getByLabel('Diagnostic center name',{exact:true}).fill('Central Diagnostics');await page.getByRole('button',{name:'Add approved diagnostic center',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Approved diagnostic center saved'})).toBeVisible();
 await page.getByLabel('Registered diagnostic staff account').selectOption(staffId);await page.getByLabel('Staff diagnostic center').selectOption(centerId);await page.getByRole('button',{name:'Approve and assign diagnostic staff'}).click();
 await expect(page.getByRole('status').filter({hasText:'staff account approved and assigned'})).toBeVisible();
 expect(operations[1]).toEqual({member_id:staffId,target_center:centerId});
 await page.getByRole('button',{name:'Suspend Central Diagnostics',exact:true}).click();await expect(page.getByRole('button',{name:'Approve Central Diagnostics',exact:true})).toBeVisible();
 expect(operations[2].decision).toBe('rejected');
});
test('staff sees approved center access and Account without patient or pharmacy features',async({page})=>{
 await mock(page);await signIn(page);
 await expect(page.getByRole('heading',{name:'Diagnostic center',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Central Diagnostics',exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('approved and linked');
 await expect(page.getByLabel('Unique Chip ID or Global ID')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Pharmacy fulfillment'})).toHaveCount(0);
 await expect(page.getByText('Diagnostic test ordering and results submission are not available in this version.')).toBeVisible();
 await page.screenshot({path:'test-results/diagnostic-center-access.png',fullPage:true});
 await page.getByRole('button',{name:'Account',exact:true}).click();await expect(page.getByRole('heading',{name:'Account',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Diagnostic center administration'})).toHaveCount(0);
 await page.getByRole('button',{name:'Log Out',exact:true}).click();await expect(page.getByRole('heading',{name:'Veterinarian login'})).toBeVisible();
});
for(const status of ['pending','rejected'])test(`${status} diagnostic staff remains restricted`,async({page})=>{
 await mock(page,'diagnostic_staff',status);await signIn(page);await expect(page.getByRole('heading',{name:'Account status'})).toBeVisible();await expect(page.getByRole('heading',{name:'Diagnostic center',exact:true})).toHaveCount(0);
});
test('center suspension removes effective access on refresh',async({page})=>{
 await mock(page);await signIn(page);await expect(page.getByRole('status')).toContainText('approved and linked');
 await page.route('**/rest/v1/rpc/paws_diagnostic_center_id',route=>route.fulfill({json:null}));
 await page.getByRole('button',{name:'Refresh center access'}).click();await expect(page.getByRole('alert')).toContainText('not linked to an approved diagnostic center');await expect(page.getByRole('heading',{name:'Central Diagnostics'})).toHaveCount(0);
});
test('diagnostic staff signup requests pending role and cannot select membership',async({page})=>{
 await mock(page);const requests=[];await page.route('**/auth/v1/signup*',route=>{requests.push(route.request().postDataJSON());return route.fulfill({json:{id:staffId,email:'newstaff@example.com',aud:'authenticated'}});});
 await page.goto('/register');await page.getByLabel('Account type').selectOption('diagnostic_staff');await page.getByLabel('Full name',{exact:true}).fill('New Staff');await page.getByLabel('Email',{exact:true}).fill('newstaff@example.com');await page.getByLabel('Password',{exact:true}).fill('Longer-password1!');await page.getByLabel('Confirm password',{exact:true}).fill('Longer-password1!');
 const country=page.getByRole('combobox',{name:'Country',exact:true});await country.fill('Antarctica');await country.press('ArrowDown');await country.press('Enter');await page.getByRole('button',{name:'Register',exact:true}).click();await expect(page.getByRole('status')).toContainText('approved diagnostic center');
 expect(requests[0].data.account_type).toBe('diagnostic_staff');expect(requests[0].data).not.toHaveProperty('diagnostic_center_id');expect(requests[0].data).not.toHaveProperty('approval_status');
});
test('diagnostic account recovery opens password screen first',async({page})=>{
 const{token}=await mock(page);await page.goto(`/reset-password#access_token=${token}&refresh_token=refresh&token_type=bearer&expires_in=3600&type=recovery`);await expect(page.getByLabel('New password',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Diagnostic center',exact:true})).toHaveCount(0);
});
test('center setup errors are clear and can be retried',async({page})=>{
 await mock(page,'admin');await page.route('**/rest/v1/diagnostic_centers*',route=>route.fulfill({status:404,json:{message:'Missing table'}}));await signIn(page);await page.getByRole('button',{name:'Account',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Diagnostic centers could not be loaded');await expect(page.getByRole('button',{name:'Refresh diagnostic centers'})).toBeEnabled();
});
