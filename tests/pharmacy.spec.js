import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
const userId='12345678-1234-4234-8234-123456789012';
const animalId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const pharmacyId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01';
const otherPharmacy='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02';
const pharmacies=[{id:pharmacyId,name:'Central Pharmacy',approval_status:'approved'},{id:otherPharmacy,name:'West Pharmacy',approval_status:'approved'}];
const initialOrder={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee03',animal_global_id:animalId,medication_name:'Prescribed medication',dosage:'Prescribed dose',frequency:'Daily',reason:'Vet reason',prescriber_id:userId,order_status:'pending',assigned_pharmacy_id:pharmacyId,pharmacy_name:'Central Pharmacy',delivery_address:'PAWS Clinic, 123 Clinic Road',fulfillment_status:'awaiting_acceptance',fulfillment_version:0,carrier:'',tracking_number:'',tracking_url:'',fulfillment_note:'',created_at:'2026-11-06T12:00:00Z'};
async function mock(page,role='pharmacy',orders=[{...initialOrder}],status='approved') {
 const user={id:userId,aud:'authenticated',role:'authenticated',email:'staff@example.com',app_metadata:{},user_metadata:{},created_at:'2026-11-01T12:00:00Z'};
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.signature`;
 await page.route('**/auth/v1/**',route=>route.fulfill({json:route.request().url().includes('/user')?user:route.request().url().includes('/logout')?{}:{access_token:token,refresh_token:'refresh',expires_in:3600,token_type:'bearer',user}}));
 await page.route('**/rest/v1/profiles*',route=>route.fulfill({json:route.request().url().includes('id=eq.')?{...user,role,approval_status:status,pharmacy_id:pharmacyId}:[{...user,full_name:'Pharmacy Staff',role:'veterinarian',approval_status:'pending'}]}));
 await page.route('**/rest/v1/diagnostic_centers*',route=>route.fulfill({json:[]}));
 await page.route('**/rest/v1/pharmacies*',route=>route.fulfill({json:pharmacies}));
 await page.route('**/rest/v1/rpc/paws_pharmacy_id',route=>route.fulfill({json:pharmacyId}));
 await page.route('**/rest/v1/medication_orders*',route=>route.fulfill({json:orders}));
 await page.route('**/rest/v1/animals*',route=>route.fulfill({json:{chip_id:'TEST123',global_id:animalId,name:'Buddy',animal:'Dog',species:'Pug',age:3}}));
 return orders;
}
async function signIn(page){await page.goto('/');await page.getByLabel('Email',{exact:true}).fill('staff@example.com');await page.getByLabel('Password',{exact:true}).fill('Longer-password1!');await page.getByRole('button',{name:'Log In'}).click();}
async function openMedication(page){await signIn(page);await page.getByLabel('Unique Chip ID or Global ID').fill('TEST123');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('button',{name:'Medications',exact:true}).first().click();}
test('pharmacy accepts, ships and delivers with read-only prescription details',async({page})=>{
 const orders=await mock(page);const updates=[];
 await page.route('**/rest/v1/rpc/update_medication_fulfillment',route=>{const args=route.request().postDataJSON();updates.push(args);orders[0]={...orders[0],fulfillment_status:args.next_status,carrier:args.shipping_carrier,tracking_number:args.shipping_number,tracking_url:args.shipping_url,fulfillment_note:args.note,fulfillment_version:orders[0].fulfillment_version+1,order_status:args.next_status==='delivered'?'fulfilled':'pending'};return route.fulfill({json:orders[0]});});
 await signIn(page);
 await expect(page.getByRole('heading',{name:'Pharmacy fulfillment'})).toBeVisible();
 await expect(page.getByLabel('Unique Chip ID or Global ID')).toHaveCount(0);
 await expect(page.getByLabel('Dosage',{exact:true})).toHaveCount(0);
 await expect(page.getByText('PAWS Clinic, 123 Clinic Road',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Save fulfillment update'}).click();
 await expect(page.getByText('Fulfillment: Processing',{exact:true})).toBeVisible();
 await page.getByLabel('Carrier',{exact:true}).fill('Carrier');await page.getByLabel('Tracking number',{exact:true}).fill('TRACK123');
 await page.getByLabel('Tracking link (optional, HTTPS)').fill('http://tracking.example.com/TRACK123');
 await page.getByRole('button',{name:'Save fulfillment update'}).click();await expect(page.getByRole('alert')).toContainText('HTTPS');expect(updates).toHaveLength(1);
 await page.getByLabel('Tracking link (optional, HTTPS)').fill('https://tracking.example.com/TRACK123');await page.getByRole('button',{name:'Save fulfillment update'}).click();
 await expect(page.getByRole('link',{name:'Track shipment'})).toHaveAttribute('href','https://tracking.example.com/TRACK123');
 await page.screenshot({path:'test-results/pharmacy-shipped.png',fullPage:true});
 await page.getByLabel('Fulfillment action').selectOption('delivered');await page.getByRole('button',{name:'Save fulfillment update'}).click();
 await expect(page.getByText('Fulfillment: Delivered',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save fulfillment update'})).toHaveCount(0);
 expect(updates.map(item=>item.expected_version)).toEqual([0,1,2]);expect(updates.every(item=>!('dosage' in item)&&!('prescriber_id'in item))).toBe(true);
 await page.getByRole('button',{name:'Refresh orders'}).click();await expect(page.getByText('Fulfillment: Delivered',{exact:true})).toBeVisible();
});
test('decline requires reason and conflicts preserve entries',async({page})=>{
 await mock(page);let calls=0;
 await page.route('**/rest/v1/rpc/update_medication_fulfillment',route=>{calls++;return route.fulfill({status:409,json:{code:'40001',message:'Changed'}});});
 await signIn(page);await page.getByLabel('Fulfillment action').selectOption('declined');
 await page.getByRole('button',{name:'Save fulfillment update'}).click();expect(calls).toBe(0);
 await page.getByLabel('Decline / release reason').fill('Out of stock');await page.getByRole('button',{name:'Save fulfillment update'}).click();
 await expect(page.getByRole('alert')).toContainText('Refresh orders');await expect(page.getByLabel('Decline / release reason')).toHaveValue('Out of stock');
});
test('vet selects pharmacy and delivery address when prescribing, then reassigns a declined order',async({page})=>{
 const orders=await mock(page,'veterinarian',[]);const saves=[];
 await page.route('**/rest/v1/medication_orders*',route=>{if(route.request().method()==='POST'){const data=route.request().postDataJSON();saves.push(data);orders.push({...initialOrder,...data,fulfillment_status:'declined',fulfillment_note:'Out of stock'});return route.fulfill({status:201,body:''});}return route.fulfill({json:orders});});
 const assignments=[];await page.route('**/rest/v1/rpc/assign_medication_pharmacy',route=>{const args=route.request().postDataJSON();assignments.push(args);orders[0]={...orders[0],assigned_pharmacy_id:args.target_pharmacy,pharmacy_name:'West Pharmacy',fulfillment_status:'awaiting_acceptance',fulfillment_version:1};return route.fulfill({json:orders[0]});});
 await openMedication(page);
 await page.getByLabel('Medication',{exact:true}).fill('Prescribed medication');await page.getByLabel('Dosage',{exact:true}).fill('Prescribed dose');await page.getByLabel('Frequency',{exact:true}).fill('Daily');await page.getByLabel('Reason',{exact:true}).fill('Vet reason');
 await page.getByLabel('Pharmacy',{exact:true}).selectOption(pharmacyId);await page.getByLabel('Clinic delivery address and recipient',{exact:true}).fill('PAWS Clinic, 123 Clinic Road');
 await page.getByRole('button',{name:'Save Medication Order'}).click();await expect(page.getByRole('status')).toContainText('Medication order saved');
 expect(saves[0]).toMatchObject({assigned_pharmacy_id:pharmacyId,delivery_address:'PAWS Clinic, 123 Clinic Road'});
 const assignment=page.getByRole('form',{name:'Pharmacy assignment'});await assignment.getByLabel('Assign pharmacy').selectOption(otherPharmacy);await assignment.getByRole('button',{name:'Save pharmacy assignment'}).click();
 await expect(page.getByText('Pharmacy: West Pharmacy',{exact:true})).toBeVisible();expect(assignments[0].expected_version).toBe(0);
});
test('vet sees shipment tracking and cannot cancel or reassign an accepted order',async({page})=>{
 await mock(page,'veterinarian',[{...initialOrder,fulfillment_status:'shipped',carrier:'Carrier',tracking_number:'TRACK123',tracking_url:'https://tracking.example.com/TRACK123'}]);await openMedication(page);
 await expect(page.getByRole('link',{name:'Track shipment'})).toBeVisible();await expect(page.getByRole('button',{name:'Cancel Order',exact:true})).toHaveCount(0);await expect(page.getByRole('form',{name:'Pharmacy assignment'})).toHaveCount(0);
});
test('admin creates approved pharmacy and associates registered staff',async({page})=>{
 await mock(page,'admin',[]);const operations=[];
 for(const method of ['save_pharmacy','assign_pharmacy_member']) await page.route(`**/rest/v1/rpc/${method}`,route=>{operations.push({method,args:route.request().postDataJSON()});return route.fulfill({json:method==='save_pharmacy'?pharmacyId:null});});
 await signIn(page);await page.getByRole('button',{name:'Account',exact:true}).click();
 await page.getByLabel('Pharmacy name',{exact:true}).fill('North Pharmacy');await page.getByRole('button',{name:'Add approved pharmacy'}).click();await expect(page.getByRole('status')).toContainText('Approved pharmacy saved');
 await page.getByLabel('Registered staff account').selectOption(userId);await page.getByLabel('Staff pharmacy').selectOption(pharmacyId);await page.getByRole('button',{name:'Approve and assign pharmacy staff'}).click();
 await expect(page.getByRole('status')).toContainText('staff account approved and assigned');expect(operations[1]).toEqual({method:'assign_pharmacy_member',args:{member_id:userId,target_pharmacy:pharmacyId}});
});
for(const status of ['pending','rejected'])test(`${status} pharmacy account stays restricted`,async({page})=>{await mock(page,'pharmacy',[],status);await signIn(page);await expect(page.getByRole('heading',{name:'Account status'})).toBeVisible();await expect(page.getByRole('heading',{name:'Pharmacy fulfillment'})).toHaveCount(0);});

test('pharmacy signup requests pending pharmacy access without choosing an organization or approval',async({page})=>{
 await mock(page,'pharmacy',[],'pending');const signups=[];
 await page.route('**/auth/v1/signup*',route=>{signups.push(route.request().postDataJSON());return route.fulfill({json:{id:userId,email:'newstaff@example.com',aud:'authenticated'}});});
 await page.goto('/register');await page.getByLabel('Account type').selectOption('pharmacy');
 await page.getByLabel('Full name',{exact:true}).fill('New Staff');await page.getByLabel('Email',{exact:true}).fill('newstaff@example.com');
 await page.getByLabel('Password',{exact:true}).fill('Longer-password1!');await page.getByLabel('Confirm password',{exact:true}).fill('Longer-password1!');
 const country=page.getByRole('combobox',{name:'Country',exact:true});await country.fill('Antarctica');await country.press('ArrowDown');await country.press('Enter');
 await page.getByRole('button',{name:'Register',exact:true}).click();await expect(page.getByRole('status')).toContainText('linked to an approved pharmacy');
 expect(signups[0].data.account_type).toBe('pharmacy');expect(signups[0].data).not.toHaveProperty('approval_status');expect(signups[0].data).not.toHaveProperty('pharmacy_id');
});
test('pharmacy recovery link opens reset screen instead of fulfillment queue',async({page})=>{
 await mock(page);const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.signature`;
 await page.goto(`/reset-password#access_token=${token}&refresh_token=refresh&token_type=bearer&expires_in=3600&type=recovery`);
 await expect(page.getByLabel('New password',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Pharmacy fulfillment'})).toHaveCount(0);
});

test('administrator gets a clear explanation when only the prescriber may assign',async({page})=>{
 await mock(page,'admin',[{...initialOrder,assigned_pharmacy_id:null,pharmacy_name:null,fulfillment_status:'unassigned'}]);await openMedication(page);
 await expect(page.getByText('Only the original prescribing veterinarian can assign this prescription',{exact:false})).toBeVisible();
 await expect(page.getByRole('form',{name:'Pharmacy assignment'})).toHaveCount(0);
});
test('missing pharmacy migration is explained instead of silently hiding assignment',async({page})=>{
 const legacy={...initialOrder};delete legacy.fulfillment_status;delete legacy.fulfillment_version;
 await mock(page,'veterinarian',[legacy]);await openMedication(page);
 await expect(page.getByRole('alert')).toContainText('Apply the pharmacy fulfillment migration');
});
