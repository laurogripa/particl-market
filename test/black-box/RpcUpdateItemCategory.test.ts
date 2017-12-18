import { rpc, api } from './lib/api';
import * as crypto from 'crypto-js';
import { BlackBoxTestUtil } from './lib/BlackBoxTestUtil';

describe('UpdateCategory', () => {

    const testUtil = new BlackBoxTestUtil();
    const method = 'updatecategory';

    const parentCategory = {
        id: 0,
        key: 'cat_high_real_estate'
    };

    let newCategory;

    beforeAll(async () => {
        await testUtil.cleanDb();

        // create category
        const res = await rpc('getcategory', [parentCategory.key]);
        const categoryResult: any = res.getBody()['result'];
        parentCategory.id = categoryResult.id;

        const addCategoryRes: any = await testUtil.addData('itemcategory', {
            name: 'sample category',
            description: 'sample category description',
            parent_item_category_id: parentCategory.id
        });
        newCategory = addCategoryRes.getBody()['result'];
    });

    let categoryData = {
        name: 'Sample Category update',
        description: 'Sample Category Description update'
    };

    test('Should update the category with parent category id', async () => {
        /*
         *  [0]: category id
         *  [1]: category name
         *  [2]: description
         *  [3]: parentItemCategoryId
         */
        categoryData.id = newCategory.id;
        const res = await rpc(method, [categoryData.id, categoryData.name, categoryData.description, parentCategory.id]);
        res.expectJson();
        res.expectStatusCode(200);
        const result: any = res.getBody()['result'];
        expect(result.name).toBe(categoryData.name);
        expect(result.description).toBe(categoryData.description);
        expect(result.parentItemCategoryId).toBe(parentCategory.id);
        expect(result.ParentItemCategory.key).toBe(parentCategory.key);
    });

    categoryData = {
        name: 'Sample Cat update',
        description: 'Sample Cat Description update'
    };

    test('Should update the category with parent category key', async () => {
        categoryData.id = newCategory.id;
        const res = await rpc(method, [categoryData.id, categoryData.name, categoryData.description, parentCategory.key]);
        res.expectJson();
        res.expectStatusCode(200);
        const result: any = res.getBody()['result'];
        expect(result.name).toBe(categoryData.name);
        expect(result.description).toBe(categoryData.description);
        expect(result.parentItemCategoryId).toBe(parentCategory.id);
        expect(result.ParentItemCategory.key).toBe(parentCategory.key);
    });

    test('Should not update the default category', async () => {
        const res = await rpc(method, [parentCategory.id, categoryData.name, categoryData.description, parentCategory.parentItemCategoryId]);
        res.expectJson();
        res.expectStatusCode(404);
    });

    test('Should not update the category if listing-item related with category', async () => {
        const hash = crypto.SHA256(new Date().getTime().toString()).toString();
        const listingitemData = {
            hash,
            itemInformation: {
                title: 'item title1',
                shortDescription: 'item short desc1',
                longDescription: 'item long desc1',
                itemCategory: {
                    id: categoryData.id
                }
            }
        };
        const listingItems = await testUtil.addData('listingitem', listingitemData);
        const res = await rpc(method, [categoryData.id, categoryData.name, categoryData.description, parentCategory.id]);
        res.expectJson();
        res.expectStatusCode(404);
    });

});