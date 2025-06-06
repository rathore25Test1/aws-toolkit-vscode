/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import * as sinon from 'sinon'
import { Ec2ParentNode } from '../../../../awsService/ec2/explorer/ec2ParentNode'
import { Ec2Client, Ec2Instance } from '../../../../shared/clients/ec2'
import {
    assertNodeListOnlyHasErrorNode,
    assertNodeListOnlyHasPlaceholderNode,
} from '../../../utilities/explorerNodeAssertions'
import { Ec2InstanceNode } from '../../../../awsService/ec2/explorer/ec2InstanceNode'
import * as FakeTimers from '@sinonjs/fake-timers'
import { installFakeClock } from '../../../testUtil'
import { Filter } from '@aws-sdk/client-ec2'
import { AsyncCollection } from '../../../../shared/utilities/asyncCollection'
import { intoCollection } from '../../../../shared/utilities/collectionUtils'

export const testInstance = {
    InstanceId: 'testId',
    Tags: [
        {
            Key: 'Name',
            Value: 'testName',
        },
    ],
    LastSeenStatus: 'running',
} satisfies Ec2Instance
export const testClient = new Ec2Client('')
export const testParentNode = new Ec2ParentNode('fake-region', 'testPartition', testClient)

describe('ec2ParentNode', function () {
    let testNode: Ec2ParentNode
    let client: Ec2Client
    let getInstancesStub: sinon.SinonStub<[filters?: Filter[] | undefined], AsyncCollection<Ec2Instance[]>>
    let clock: FakeTimers.InstalledClock
    let refreshStub: sinon.SinonStub<[], Promise<void>>
    let statusUpdateStub: sinon.SinonStub<[status: string], Promise<string>>
    const testRegion = 'testRegion'
    const testPartition = 'testPartition'

    before(function () {
        client = new Ec2Client(testRegion)
        clock = installFakeClock()
        refreshStub = sinon.stub(Ec2InstanceNode.prototype, 'refreshNode')
        statusUpdateStub = sinon.stub(Ec2Client.prototype, 'getInstanceStatus')
    })

    beforeEach(function () {
        getInstancesStub = sinon.stub(Ec2Client.prototype, 'getInstances')
        testNode = new Ec2ParentNode(testRegion, testPartition, client)
        refreshStub.resetHistory()
    })

    afterEach(function () {
        getInstancesStub.restore()
        testNode.pollingSet.clear()
        testNode.pollingSet.clearTimer()
    })

    after(function () {
        clock.uninstall()
        sinon.restore()
    })

    it('returns placeholder node if no children are present', async function () {
        getInstancesStub.returns(intoCollection([]))

        const childNodes = await testNode.getChildren()
        assertNodeListOnlyHasPlaceholderNode(childNodes)
        getInstancesStub.restore()
    })

    it('has instance child nodes', async function () {
        const instances = [
            { Name: 'firstOne', InstanceId: '0', LastSeenStatus: 'running' },
            { Name: 'secondOne', InstanceId: '1', LastSeenStatus: 'stopped' },
        ] satisfies Ec2Instance[]
        getInstancesStub.returns(intoCollection([instances]))
        const childNodes = await testNode.getChildren()

        assert.strictEqual(childNodes.length, instances.length, 'Unexpected child count')

        for (const node of childNodes) {
            assert.ok(node instanceof Ec2InstanceNode, 'Expected child node to be Ec2InstanceNode')
        }

        getInstancesStub.restore()
    })

    it('sorts child nodes', async function () {
        const sortedText = ['aa', 'ab', 'bb', 'bc', 'cc', 'cd']
        const instances = [
            { Name: 'ab', InstanceId: '0', LastSeenStatus: 'running' },
            { Name: 'bb', InstanceId: '1', LastSeenStatus: 'running' },
            { Name: 'bc', InstanceId: '2', LastSeenStatus: 'running' },
            { Name: 'aa', InstanceId: '3', LastSeenStatus: 'running' },
            { Name: 'cc', InstanceId: '4', LastSeenStatus: 'running' },
            { Name: 'cd', InstanceId: '5', LastSeenStatus: 'running' },
        ] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))

        const childNodes = await testNode.getChildren()

        const actualChildOrder = childNodes.map((node) => (node instanceof Ec2InstanceNode ? node.name : undefined))
        assert.deepStrictEqual(actualChildOrder, sortedText, 'Unexpected child sort order')
        getInstancesStub.restore()
    })

    it('has an error node for a child if an error happens during loading', async function () {
        getInstancesStub.throws(new Error())
        const node = new Ec2ParentNode(testRegion, testPartition, client)
        assertNodeListOnlyHasErrorNode(await node.getChildren())
        getInstancesStub.restore()
    })

    it('is able to handle children with duplicate names', async function () {
        const instances = [
            { Name: 'firstOne', InstanceId: '0', LastSeenStatus: 'running' },
            { Name: 'secondOne', InstanceId: '1', LastSeenStatus: 'running' },
            { Name: 'firstOne', InstanceId: '2', LastSeenStatus: 'running' },
        ] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))

        const childNodes = await testNode.getChildren()
        assert.strictEqual(childNodes.length, instances.length, 'Unexpected child count')
        getInstancesStub.restore()
    })

    it('adds pending nodes to the polling nodes set', async function () {
        const instances = [
            { Name: 'firstOne', InstanceId: '0', LastSeenStatus: 'pending' },
            { Name: 'secondOne', InstanceId: '1', LastSeenStatus: 'stopped' },
            { Name: 'thirdOne', InstanceId: '2', LastSeenStatus: 'running' },
        ] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))
        await testNode.updateChildren()
        assert.strictEqual(testNode.pollingSet.size, 1)
        getInstancesStub.restore()
    })

    it('does not refresh explorer when timer goes off if status unchanged', async function () {
        statusUpdateStub = statusUpdateStub.resolves('pending')
        const instances = [
            { Name: 'firstOne', InstanceId: '0', LastSeenStatus: 'pending' },
            { Name: 'secondOne', InstanceId: '1', LastSeenStatus: 'stopped' },
            { Name: 'thirdOne', InstanceId: '2', LastSeenStatus: 'running' },
        ] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))

        await testNode.updateChildren()
        await clock.tickAsync(6000)
        sinon.assert.notCalled(refreshStub)
        getInstancesStub.restore()
    })

    it('does refresh explorer when timer goes and status changed', async function () {
        statusUpdateStub = statusUpdateStub.resolves('running')
        const instances = [{ Name: 'firstOne', InstanceId: '0', LastSeenStatus: 'pending' }] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))
        await testNode.updateChildren()

        sinon.assert.notCalled(refreshStub)
        await clock.tickAsync(6000)
        sinon.assert.called(refreshStub)
    })

    it('returns the node when in the map', async function () {
        const instances = [{ Name: 'firstOne', InstanceId: 'node1', LastSeenStatus: 'pending' }] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))
        await testNode.updateChildren()
        const node = testNode.getInstanceNode('node1')
        assert.strictEqual(node.InstanceId, instances[0].InstanceId)
        getInstancesStub.restore()
    })

    it('throws error when node not in map', async function () {
        const instances = [{ Name: 'firstOne', InstanceId: 'node1', LastSeenStatus: 'pending' }] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))
        await testNode.updateChildren()
        assert.throws(() => testNode.getInstanceNode('node2'))
        getInstancesStub.restore()
    })

    it('adds node to polling set when asked to track it', async function () {
        const instances = [{ Name: 'firstOne', InstanceId: 'node1', LastSeenStatus: 'pending' }] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))
        await testNode.updateChildren()
        testNode.trackPendingNode('node1')
        assert.strictEqual(testNode.pollingSet.size, 1)
        getInstancesStub.restore()
    })

    it('throws error when asked to track non-child node', async function () {
        const instances = [{ Name: 'firstOne', InstanceId: 'node1', LastSeenStatus: 'pending' }] satisfies Ec2Instance[]

        getInstancesStub.returns(intoCollection([instances]))
        await testNode.updateChildren()
        assert.throws(() => testNode.trackPendingNode('node2'))
        getInstancesStub.restore()
    })
})
